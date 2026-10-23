import { z } from "zod";
import { idSchema, MAX_MESSAGE_LENGTH } from "@/lib/shared/validation";
import type { Outgoing } from "./chat-slice";

const mediaSchema = z.object({
  id: idSchema,
  url: z.string().url(),
  kind: z.enum(["image", "video"]),
  name: z.string(),
  altText: z.string().optional(),
});

const outgoingSchema = z.object({
  clientNonce: idSchema,
  conversationId: idSchema,
  body: z.string().max(MAX_MESSAGE_LENGTH),
  media: mediaSchema.nullable(),
  uploadId: idSchema.optional(),
  createdAt: z.string().datetime(),
  status: z.enum(["queued", "sending", "failed"]),
  error: z.string().nullable(),
});

const outboxSchema = z.array(outgoingSchema);

const storageKey = (userId: string) => `relay:outbox:v1:${userId}`;

export function loadOutbox(userId: string): Outgoing[] {
  if (typeof window === "undefined") return [];

  try {
    const stored = localStorage.getItem(storageKey(userId));
    if (!stored) return [];

    const parsed = outboxSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveOutbox(userId: string, messages: Outgoing[]): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(messages));
  } catch {
    // Storage may be unavailable or full.
  }
}

export function clearOutbox(userId: string): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // Storage may be unavailable.
  }
}
