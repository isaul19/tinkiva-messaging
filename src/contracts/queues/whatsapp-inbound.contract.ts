import { z } from "zod";

import {
  whatsappContactSchema,
  whatsappMessageSchema,
  whatsappStatusSchema,
} from "../providers/whatsapp.contract.js";
import { createQueueEnvelopeSchema } from "./queue-envelope.contract.js";

export const whatsappInboundMessagePayloadSchema = z.strictObject({
  contact: whatsappContactSchema.optional(),
  kind: z.literal("MESSAGE"),
  message: whatsappMessageSchema,
  phoneNumberId: z.string().min(1),
});

export const whatsappInboundStatusPayloadSchema = z.strictObject({
  kind: z.literal("STATUS"),
  phoneNumberId: z.string().min(1),
  status: whatsappStatusSchema,
});

export const whatsappInboundMessageEnvelopeSchema = createQueueEnvelopeSchema(
  whatsappInboundMessagePayloadSchema,
).extend({
  eventType: z.literal("whatsapp.message.received"),
});

export const whatsappInboundStatusEnvelopeSchema = createQueueEnvelopeSchema(
  whatsappInboundStatusPayloadSchema,
).extend({
  eventType: z.literal("whatsapp.message.status"),
});

export const whatsappInboundEnvelopeSchema = z.discriminatedUnion("eventType", [
  whatsappInboundMessageEnvelopeSchema,
  whatsappInboundStatusEnvelopeSchema,
]);

export type WhatsappInboundEnvelope = z.infer<typeof whatsappInboundEnvelopeSchema>;
export type WhatsappInboundMessageEnvelope = z.infer<typeof whatsappInboundMessageEnvelopeSchema>;
export type WhatsappInboundStatusEnvelope = z.infer<typeof whatsappInboundStatusEnvelopeSchema>;
