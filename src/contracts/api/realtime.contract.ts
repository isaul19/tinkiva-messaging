import { z } from "zod";

import { conversationMessageSchema } from "./conversation.contract.js";
import {
  applicationIdSchema,
  conversationIdSchema,
  eventIdSchema,
  integrationIdSchema,
  tenantIdSchema,
} from "../shared/identifiers.js";

export const realtimeTicketResponseSchema = z
  .object({
    expiresAt: z.iso.datetime(),
    ticket: z.string().regex(/^rt_[0-9A-Za-z_-]{32,120}$/),
    websocketUrl: z.url().refine((value) => value.startsWith("wss://"), {
      message: "Expected a secure WebSocket URL.",
    }),
  })
  .strict();

export const realtimeMessageEventTypeSchema = z.enum([
  "message.delivered",
  "message.failed",
  "message.queued",
  "message.read",
  "message.received",
  "message.sent",
]);

export const realtimeMessageEventSchema = z
  .object({
    applicationId: applicationIdSchema,
    data: z
      .object({
        conversationId: conversationIdSchema,
        integrationId: integrationIdSchema,
        message: conversationMessageSchema,
      })
      .strict(),
    eventId: eventIdSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal(1),
    tenantId: tenantIdSchema,
    type: realtimeMessageEventTypeSchema,
  })
  .strict();

export type RealtimeMessageEvent = z.infer<typeof realtimeMessageEventSchema>;
export type RealtimeMessageEventType = z.infer<typeof realtimeMessageEventTypeSchema>;
export type RealtimeTicketResponse = z.infer<typeof realtimeTicketResponseSchema>;
