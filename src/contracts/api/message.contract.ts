import { z } from "zod";

import {
  conversationIdSchema,
  integrationIdSchema,
  messageIdSchema,
  tenantIdSchema,
} from "../shared/identifiers.js";

export const providerSchema = z.enum(["TELEGRAM", "WHATSAPP"]);

export const textContentSchema = z
  .object({
    text: z
      .object({
        body: z.string().min(1).max(4_096),
      })
      .strict(),
    type: z.literal("TEXT"),
  })
  .strict();

export const mediaContentSchema = z
  .object({
    media: z
      .object({
        caption: z.string().max(1_024).optional(),
        mediaId: z.string().trim().min(1).max(120),
      })
      .strict(),
    type: z.enum(["AUDIO", "DOCUMENT", "IMAGE", "VIDEO"]),
  })
  .strict();

export const messageContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  mediaContentSchema,
]);

export const recipientSchema = z
  .object({
    type: z.enum(["TELEGRAM_CHAT_ID", "WHATSAPP_BSUID", "WHATSAPP_PHONE"]),
    value: z.string().trim().min(1).max(255),
  })
  .strict();

export const sendMessageRequestSchema = z
  .object({
    clientReferenceId: z.string().trim().min(1).max(255).optional(),
    content: messageContentSchema,
    conversationId: conversationIdSchema.optional(),
    integrationId: integrationIdSchema,
    recipient: recipientSchema.optional(),
    tenantId: tenantIdSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const destinationCount =
      Number(request.conversationId !== undefined) + Number(request.recipient !== undefined);

    if (destinationCount !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one of conversationId or recipient is required.",
        path: ["conversationId"],
      });
    }
  });

export const sendMessageResponseSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(255),
    messageId: messageIdSchema,
    status: z.literal("QUEUED"),
  })
  .strict();

export type MessageContent = z.infer<typeof messageContentSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
