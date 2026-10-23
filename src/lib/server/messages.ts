import { randomUUID } from "node:crypto";
import { database, getMessage, isMember } from "./db";
import { sendSchema, forwardSchema } from "@/lib/shared/validation";
import type { Message } from "@/lib/shared/types";

type InputErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_MEDIA"
  | "INVALID_MESSAGE";
export class MessageError extends Error {
  constructor(public readonly code: InputErrorCode, msg: string) {
    super(msg);
  }
}

export function createMessage(senderId: string, input: unknown): Message {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success)
    throw new MessageError(
      "INVALID_MESSAGE",
      "Check message content (maximum 2,000 characters)."
    );
  const { conversationId, clientNonce, body, uploadId, altText } = parsed.data;
  let messageId = "";
  database().transaction(() => {
    if (!isMember(senderId, conversationId))
      throw new MessageError("FORBIDDEN", "Conversation access denied.");
    const prior = database()
      .prepare(
        "SELECT id, conversationId FROM messages WHERE senderId=? AND clientNonce=?"
      )
      .get(senderId, clientNonce) as
      | { id: string; conversationId: string }
      | undefined;
    if (prior) {
      if (prior.conversationId !== conversationId)
        throw new MessageError("CONFLICT", "Message nonce already used.");
      messageId = prior.id;
      return;
    }
    if (uploadId) {
      const upload = database()
        .prepare("SELECT kind FROM uploads WHERE id=? AND ownerId=?")
        .get(uploadId, senderId) as { kind: "image" | "video" } | undefined;
      if (upload?.kind === "image" && (!altText || altText.length < 5))
        throw new MessageError(
          "INVALID_MEDIA",
          "Describe the image for screen readers (at least 5 characters)."
        );
      const affected = database()
        .prepare(
          "UPDATE uploads SET usedAt=? WHERE id=? AND ownerId=? AND usedAt IS NULL"
        )
        .run(new Date().toISOString(), uploadId, senderId);
      if (affected.changes !== 1)
        throw new MessageError(
          "INVALID_MEDIA",
          "Upload missing, already used, or unauthorized."
        );
    }
    messageId = randomUUID();
    database()
      .prepare(
        "INSERT INTO messages(id,conversationId,senderId,body,mediaId,mediaAltText,forwardedFromId,clientNonce,createdAt) VALUES(?,?,?,?,?,?,?,?,?)"
      )
      .run(
        messageId,
        conversationId,
        senderId,
        body,
        uploadId ?? null,
        altText ?? null,
        null,
        clientNonce,
        new Date().toISOString()
      );
  })();
  return getMessage(messageId)!;
}
export function forwardMessage(senderId: string, input: unknown): Message {
  const parsed = forwardSchema.safeParse(input);
  if (!parsed.success)
    throw new MessageError("INVALID_MESSAGE", "Invalid forwarding request.");
  const { destinationConversationId, originalMessageId, clientNonce } =
    parsed.data;
  let messageId = "";
  database().transaction(() => {
    if (!isMember(senderId, destinationConversationId))
      throw new MessageError("FORBIDDEN", "Destination access denied.");
    const prior = database()
      .prepare(
        "SELECT id,conversationId FROM messages WHERE senderId=? AND clientNonce=?"
      )
      .get(senderId, clientNonce) as
      | { id: string; conversationId: string }
      | undefined;
    if (prior) {
      if (prior.conversationId !== destinationConversationId)
        throw new MessageError("CONFLICT", "Forward nonce already used.");
      messageId = prior.id;
      return;
    }
    const source = getMessage(originalMessageId);
    if (!source)
      throw new MessageError(
        "NOT_FOUND",
        "The original message no longer exists."
      );
    if (!isMember(senderId, source.conversationId))
      throw new MessageError("FORBIDDEN", "Original message access denied.");
    messageId = randomUUID();
    database()
      .prepare(
        "INSERT INTO messages(id,conversationId,senderId,body,mediaId,mediaAltText,forwardedFromId,clientNonce,createdAt) VALUES(?,?,?,?,?,?,?,?,?)"
      )
      .run(
        messageId,
        destinationConversationId,
        senderId,
        source.body,
        source.media?.id ?? null,
        source.media?.altText ?? null,
        source.id,
        clientNonce,
        new Date().toISOString()
      );
  })();
  return getMessage(messageId)!;
}
