import { z } from "zod";

import {
  conversationIdSchema,
  integrationIdSchema,
  messageIdSchema,
  tenantIdSchema,
} from "../shared/identifiers.js";
import { audioMimeTypeSchema } from "../shared/audio.js";
import { latitudeSchema, longitudeSchema } from "../shared/location.js";
import { providerSchema } from "./message.contract.js";

export const conversationStatusSchema = z.enum(["OPEN", "CLOSED"]);
export const messageDirectionSchema = z.enum(["INBOUND", "OUTBOUND"]);
export const messageDeliveryStatusSchema = z.enum([
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "RECEIVED",
]);

export const conversationParticipantSchema = z
  .object({
    displayName: z.string().min(1),
    phoneNumber: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
  })
  .strict();

const conversationMessageBaseSchema = z.object({
  conversationId: conversationIdSchema,
  direction: messageDirectionSchema,
  failureCode: z.string().min(1).optional(),
  integrationId: integrationIdSchema,
  messageId: messageIdSchema,
  occurredAt: z.iso.datetime(),
  provider: providerSchema,
  status: messageDeliveryStatusSchema,
});

const alternativeTextMetadataSchema = z
  .object({
    alternativeText: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const conversationMessageSchema = z
  .discriminatedUnion("type", [
    conversationMessageBaseSchema
      .extend({
        text: z.string(),
        type: z.literal("TEXT"),
      })
      .strict(),
    conversationMessageBaseSchema
      .extend({
        caption: z.string().max(1_024).optional(),
        durationSeconds: z.number().int().nonnegative().optional(),
        media: z
          .object({
            mediaId: z.string().min(1).max(1_024),
            mimeType: audioMimeTypeSchema,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            sizeBytes: z.number().int().positive(),
            url: z.url(),
          })
          .strict(),
        metadata: alternativeTextMetadataSchema.optional(),
        type: z.literal("AUDIO"),
        voice: z.boolean(),
      })
      .strict(),
    conversationMessageBaseSchema
      .extend({
        caption: z.string().max(1_024).optional(),
        media: z
          .object({
            mediaId: z.string().min(1).max(1_024),
            mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            sizeBytes: z.number().int().positive(),
            url: z.url(),
          })
          .strict(),
        metadata: alternativeTextMetadataSchema.optional(),
        type: z.literal("IMAGE"),
      })
      .strict(),
    conversationMessageBaseSchema
      .extend({
        latitude: latitudeSchema,
        longitude: longitudeSchema,
        type: z.literal("LOCATION"),
      })
      .strict(),
  ])
  .superRefine((message, context) => {
    if (
      message.direction === "OUTBOUND" &&
      "metadata" in message &&
      message.metadata !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Alternative text metadata is only valid for inbound media.",
        path: ["metadata"],
      });
    }
  });

export const conversationListItemSchema = z
  .object({
    conversationId: conversationIdSchema,
    createdAt: z.iso.datetime(),
    integrationId: integrationIdSchema,
    lastMessage: conversationMessageSchema.optional(),
    lastMessageAt: z.iso.datetime(),
    participant: conversationParticipantSchema,
    provider: providerSchema,
    status: conversationStatusSchema,
    tenantId: tenantIdSchema,
  })
  .strict();

export const listConversationsResponseSchema = z
  .object({
    items: z.array(conversationListItemSchema),
    nextCursor: z.string().min(1).optional(),
    tenantId: tenantIdSchema,
  })
  .strict();

export const listConversationMessagesResponseSchema = z
  .object({
    conversationId: conversationIdSchema,
    items: z.array(conversationMessageSchema),
    nextCursor: z.string().min(1).optional(),
    tenantId: tenantIdSchema,
  })
  .strict();

export const conversationListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(4_096).optional(),
    integrationId: integrationIdSchema,
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

export const conversationMessageListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(4_096).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type ConversationListItem = z.infer<typeof conversationListItemSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ListConversationMessagesResponse = z.infer<
  typeof listConversationMessagesResponseSchema
>;
export type ListConversationsResponse = z.infer<typeof listConversationsResponseSchema>;
