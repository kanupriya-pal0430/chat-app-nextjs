import { z } from "zod";
export const MAX_MESSAGE_LENGTH = 2000;
export const idSchema = z.string().uuid();
export const messageBody = z
  .string()
  .max(MAX_MESSAGE_LENGTH * 2)
  .transform((s) =>
    s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim()
  )
  .pipe(z.string().max(MAX_MESSAGE_LENGTH));
export const sendSchema = z
  .object({
    conversationId: idSchema,
    clientNonce: idSchema,
    body: messageBody,
    uploadId: idSchema.optional(),
    altText: z
      .string()
      .max(360)
      .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, "").trim())
      .pipe(z.string().max(180))
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.body.length > 0 || !!v.uploadId,
    "A message cannot be empty"
  );
export const forwardSchema = z
  .object({
    destinationConversationId: idSchema,
    originalMessageId: idSchema,
    clientNonce: idSchema,
  })
  .strict();
export const typingSchema = z
  .object({ conversationId: idSchema, isTyping: z.boolean() })
  .strict();
