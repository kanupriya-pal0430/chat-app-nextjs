import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Message,
  SendAck,
} from "@/lib/shared/types";
import { chatReducer, receiveMessages } from "@/store/chat-slice";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients: ChatSocket[] = [];

let serverProcess: ChildProcess;
let directory: string;
let baseUrl: string;
let conversationId: string;
let aliceCookie: string;
let bobCookie: string;

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate port"));
        return;
      }

      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (serverProcess.exitCode !== null) {
      throw new Error("Test server exited unexpectedly");
    }

    try {
      const response = await fetch(`${baseUrl}/login`);

      if (response.ok) return;
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Test server did not start");
}

async function login(name: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ name, password }),
  });

  if (!response.ok) {
    throw new Error(`Login failed for ${name}: ${response.status}`);
  }

  const cookie = response.headers.get("set-cookie")?.split(";")[0];

  if (!cookie) throw new Error("Session cookie missing");

  return cookie;
}

async function connectClient(cookie: string): Promise<ChatSocket> {
  const socket: ChatSocket = io(baseUrl, {
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie, Origin: baseUrl },
  });

  clients.push(socket);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Socket connection timed out"));
    }, 10000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    socket.connect();
  });

  return socket;
}

function send(
  socket: ChatSocket,
  body: string,
  clientNonce = randomUUID()
): Promise<SendAck> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(8500)
      .emit(
        "message:send",
        { conversationId, body, clientNonce },
        (error, response) => {
          if (error) reject(error);
          else resolve(response);
        }
      );
  });
}

function waitForMessage(
  socket: ChatSocket,
  clientNonce: string
): Promise<Message> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message:new", handler);
      reject(new Error("Message was not received"));
    }, 10000);

    const handler = (message: Message) => {
      if (message.clientNonce !== clientNonce) return;

      clearTimeout(timeout);
      socket.off("message:new", handler);
      resolve(message);
    };

    socket.on("message:new", handler);
  });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "relay-integration-"));

  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      APP_ORIGIN: baseUrl,
      DATABASE_PATH: join(directory, "chat.db"),
      ALICE_PASSWORD: "integration-alice",
      BOB_PASSWORD: "integration-bob",
      CHARLIE_PASSWORD: "integration-charlie",
    },
    stdio: "ignore",
  });

  await waitForServer();

  aliceCookie = await login("Ada Lovelace", "integration-alice");
  bobCookie = await login("Grace Hopper", "integration-bob");

  const db = new Database(join(directory, "chat.db"), {
    readonly: true,
  });

  try {
    const conversation = db
      .prepare(
        `SELECT a.conversationId AS id
         FROM members a
         JOIN members b ON a.conversationId = b.conversationId
         WHERE a.userId = ? AND b.userId = ?`
      )
      .get("ada", "grace") as { id: string } | undefined;

    if (!conversation) throw new Error("Conversation missing");

    conversationId = conversation.id;
  } finally {
    db.close();
  }
}, 120000);

afterEach(() => {
  for (const client of clients) client.disconnect();
  clients.length = 0;
});

afterAll(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    await new Promise<void>((resolve) => {
      serverProcess.once("exit", () => resolve());
      serverProcess.kill("SIGTERM");
      setTimeout(resolve, 3000);
    });
  }

  if (directory) {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

describe("Socket.IO integration", () => {
  it("delivers messages in both directions", async () => {
    const alice = await connectClient(aliceCookie);
    const bob = await connectClient(bobCookie);

    const aliceNonce = randomUUID();
    const bobReceives = waitForMessage(bob, aliceNonce);

    const aliceAck = await send(alice, "Hello Bob", aliceNonce);
    const bobMessage = await bobReceives;

    expect(aliceAck.ok).toBe(true);
    expect(bobMessage.body).toBe("Hello Bob");
    expect(bobMessage.senderId).toBe("ada");

    const bobNonce = randomUUID();
    const aliceReceives = waitForMessage(alice, bobNonce);

    const bobAck = await send(bob, "Hello Alice", bobNonce);
    const aliceMessage = await aliceReceives;

    expect(bobAck.ok).toBe(true);
    expect(aliceMessage.body).toBe("Hello Alice");
    expect(aliceMessage.senderId).toBe("grace");
  });

  it("recovers missed messages through history replay", async () => {
    const alice = await connectClient(aliceCookie);
    const bob = await connectClient(bobCookie);

    const first = await send(alice, "Before disconnect");

    if (!first.ok) throw new Error(first.error);

    alice.disconnect();

    const missed = await send(bob, "While Alice was offline");

    if (!missed.ok) throw new Error(missed.error);

    const response = await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages?after=${first.message.seq}`,
      { headers: { Cookie: aliceCookie } }
    );

    expect(response.ok).toBe(true);

    const data = (await response.json()) as {
      messages: Message[];
      hasMore: boolean;
    };

    expect(data.messages.some((m) => m.id === missed.message.id)).toBe(true);
  });

  it("prevents duplicate messages with the same nonce", async () => {
    const alice = await connectClient(aliceCookie);
    const nonce = randomUUID();

    const first = await send(alice, "Exactly once", nonce);
    const second = await send(alice, "Exactly once", nonce);

    if (!first.ok) throw new Error(first.error);
    if (!second.ok) throw new Error(second.error);

    expect(second.message.id).toBe(first.message.id);
    expect(second.message.seq).toBe(first.message.seq);

    const state = chatReducer(
      undefined,
      receiveMessages([first.message, second.message])
    );

    expect(Object.keys(state.messages)).toHaveLength(1);
  });

  it("rejects unauthenticated connections", async () => {
    const socket: ChatSocket = io(baseUrl, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: {
        Origin: baseUrl,
      },
    });

    clients.push(socket);

    const error = await new Promise<Error>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Expected authentication rejection"));
      }, 10000);

      socket.once("connect_error", (error) => {
        clearTimeout(timeout);
        resolve(error);
      });

      socket.once("connect", () => {
        clearTimeout(timeout);
        reject(new Error("Unauthorized socket connected"));
      });

      socket.connect();
    });

    expect(error.message).toBe("UNAUTHORIZED");
  });
});
