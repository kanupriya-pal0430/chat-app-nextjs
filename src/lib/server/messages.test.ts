// @vitest-environment node
import { beforeAll, describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { database, getConversations } from "./db";
import { createMessage, forwardMessage, MessageError } from "./messages";

let first = "";
let second = "";

beforeAll(() => {
  process.env.DATABASE_PATH = join(
    mkdtempSync(join(tmpdir(), "relay-test-")),
    "chat.db"
  );

  process.env.ALICE_PASSWORD = "test-ada";
  process.env.BOB_PASSWORD = "test-grace";
  process.env.CHARLIE_PASSWORD = "test-linus";

  database();

  const conversations = getConversations("ada");

  first = conversations.find((c) => c.otherUser.id === "grace")!.id;

  second = conversations.find((c) => c.otherUser.id === "linus")!.id;
});

describe("transactional message persistence", () => {
  it("does not duplicate a message on retried ACK", () => {
    const payload = {
      conversationId: first,
      clientNonce: randomUUID(),
      body: "Once",
    };

    const a = createMessage("ada", payload);
    const b = createMessage("ada", payload);

    expect(a.id).toBe(b.id);
    expect(a.seq).toBe(b.seq);
  });

  it("rejects a spoofed sender who is not a conversation member", () => {
    expect(() =>
      createMessage("linus", {
        conversationId: first,
        clientNonce: randomUUID(),
        body: "Intrusion",
      })
    ).toThrowError(MessageError);
  });

  it("enforces accessible image descriptions and consumes only owner uploads", () => {
    const uploadId = randomUUID();

    database()
      .prepare(
        "INSERT INTO uploads(id,ownerId,url,kind,name,usedAt) VALUES(?,?,?,?,?,NULL)"
      )
      .run(
        uploadId,
        "ada",
        "https://res.cloudinary.com/example/image/upload/photo.jpg",
        "image",
        "photo.jpg"
      );

    const payload = {
      conversationId: first,
      clientNonce: randomUUID(),
      body: "",
      uploadId,
    };

    expect(() => createMessage("ada", payload)).toThrowError(MessageError);

    expect(() =>
      createMessage("grace", {
        ...payload,
        clientNonce: randomUUID(),
        altText: "Two friends together",
      })
    ).toThrowError(MessageError);

    const sent = createMessage("ada", {
      ...payload,
      altText: "Two friends together",
    });

    expect(sent.media?.altText).toBe("Two friends together");

    expect(() =>
      createMessage("ada", {
        ...payload,
        clientNonce: randomUUID(),
        altText: "Two friends together",
      })
    ).toThrowError(MessageError);
  });

  it("forwards an immutable snapshot and refuses inaccessible sources", () => {
    const original = createMessage("grace", {
      conversationId: first,
      clientNonce: randomUUID(),
      body: "Snapshot",
    });

    const forwarded = forwardMessage("ada", {
      destinationConversationId: second,
      originalMessageId: original.id,
      clientNonce: randomUUID(),
    });

    expect(forwarded.body).toBe("Snapshot");
    expect(forwarded.forwardedFromId).toBe(original.id);

    expect(() =>
      forwardMessage("linus", {
        destinationConversationId: second,
        originalMessageId: original.id,
        clientNonce: randomUUID(),
      })
    ).toThrowError(MessageError);
  });
});
