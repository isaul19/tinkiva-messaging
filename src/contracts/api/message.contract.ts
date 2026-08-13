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

const mediaSourceSchema = z
  .object({
    caption: z.string().max(1_024).optional(),
    mediaId: z.string().trim().min(1).max(1_024).optional(),
    text: z.string().min(1).max(1_024).optional(),
    url: z
      .url()
      .refine((value) => value.startsWith("https://"), {
        message: "Only HTTPS media URLs are accepted.",
      })
      .optional(),
  })
  .strict()
  .superRefine((media, context) => {
    if (Number(media.mediaId !== undefined) + Number(media.url !== undefined) !== 1) {
      context.addIssue({
        code: "custom",
        message: "Exactly one of mediaId or url is required.",
        path: ["mediaId"],
      });
    }
    if (media.caption !== undefined && media.text !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Use either text or caption, not both.",
        path: ["text"],
      });
    }
  });

export const imageContentSchema = z
  .object({
    media: mediaSourceSchema,
    type: z.literal("IMAGE"),
  })
  .strict();

// Backward-compatible export for SDK consumers that imported the image schema by its old name.
export const mediaContentSchema = imageContentSchema;

export const audioContentSchema = z
  .object({
    media: mediaSourceSchema,
    type: z.literal("AUDIO"),
  })
  .strict();

export const messageContentSchema = z.discriminatedUnion("type", [
  textContentSchema,
  imageContentSchema,
  audioContentSchema,
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
