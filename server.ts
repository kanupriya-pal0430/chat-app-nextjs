// A long-lived Node process is required for Socket.IO. Do not deploy this as serverless functions.
import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import "./runtime-init";
import { userForCookieHeader } from "./src/lib/server/auth";
import {
  createMessage,
  forwardMessage,
  MessageError,
} from "./src/lib/server/messages";
import { isMember, memberConversationIds } from "./src/lib/server/db";
import { typingSchema } from "./src/lib/shared/validation";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
  SendAck,
} from "./src/lib/shared/types";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const app = next({ dev, hostname, port });

async function bootstrap() {
  await app.prepare();
  const server = createServer((req, res) => {
    app
      .getRequestHandler()(req, res)
      .catch((error) => {
        console.error("Unhandled HTTP request error", error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Internal server error");
        } else res.destroy(error instanceof Error ? error : undefined);
      });
  });
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(server, {
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 1024 * 16,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120_000,
      skipMiddlewares: false,
    },
  });
  io.use((socket, nextMiddleware) => {
    try {
      const user = userForCookieHeader(socket.handshake.headers.cookie);
      if (!user) return nextMiddleware(new Error("UNAUTHORIZED"));
      socket.data.user = user;
      nextMiddleware();
    } catch {
      nextMiddleware(new Error("UNAUTHORIZED"));
    }
  });
  io.on("connection", (socket) => {
    const user = socket.data.user;
    for (const id of memberConversationIds(user.id))
      void socket.join(`conversation:${id}`);
    let hits = 0;
    let windowStart = Date.now();
    const allowed = () => {
      if (Date.now() - windowStart > 60_000) {
        windowStart = Date.now();
        hits = 0;
      }
      return ++hits <= 50;
    };
    const stillAuthenticated = () =>
      userForCookieHeader(socket.handshake.headers.cookie)?.id === user.id;
    const ackError = (err: unknown): SendAck =>
      err instanceof MessageError
        ? { ok: false, code: err.code, error: err.message }
        : {
            ok: false,
            code: "INTERNAL",
            error: "Unable to process message. Please retry.",
          };
    socket.on("message:send", (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!stillAuthenticated()) {
        ack({ ok: false, code: "UNAUTHORIZED", error: "Session expired." });
        socket.disconnect(true);
        return;
      }
      if (!allowed())
        return ack({
          ok: false,
          code: "RATE_LIMIT",
          error: "Too many messages. Try again shortly.",
        });
      try {
        const msg = createMessage(user.id, payload);
        io.to(`conversation:${msg.conversationId}`).emit("message:new", msg);
        ack({ ok: true, message: msg });
      } catch (e) {
        console.error("send failed", e instanceof MessageError ? e.code : e);
        ack(ackError(e));
      }
    });
    socket.on("message:forward", (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!stillAuthenticated()) {
        ack({ ok: false, code: "UNAUTHORIZED", error: "Session expired." });
        socket.disconnect(true);
        return;
      }
      if (!allowed())
        return ack({
          ok: false,
          code: "RATE_LIMIT",
          error: "Too many messages. Try again shortly.",
        });
      try {
        const msg = forwardMessage(user.id, payload);
        io.to(`conversation:${msg.conversationId}`).emit("message:new", msg);
        ack({ ok: true, message: msg });
      } catch (e) {
        console.error("forward failed", e instanceof MessageError ? e.code : e);
        ack(ackError(e));
      }
    });
    socket.on("typing:set", (raw) => {
      const parsed = typingSchema.safeParse(raw);
      if (!stillAuthenticated()) {
        socket.disconnect(true);
        return;
      }
      if (!parsed.success || !isMember(user.id, parsed.data.conversationId))
        return;
      socket
        .to(`conversation:${parsed.data.conversationId}`)
        .emit("typing:update", { ...parsed.data, userId: user.id });
    });
  });
  server.listen(port, hostname, () =>
    console.log(`Relay Chat → http://${hostname}:${port}`)
  );
}
bootstrap().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
