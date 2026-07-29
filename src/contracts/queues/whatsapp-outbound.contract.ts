import { z } from "zod";

import { messageContentSchema } from "../api/message.contract.js";
import { conversationIdSchema, messageIdSchema } from "../shared/identifiers.js";
import { createQueueEnvelopeSchema } from "./queue-envelope.contract.js";

export const whatsappOutboundPayloadSchema = z
  .object({
    content: messageContentSchema,
    conversationId: conversationIdSchema,
    messageId: messageIdSchema,
    recipientId: z.string().min(1).max(255),
    recipientType: z.enum(["WHATSAPP_BSUID", "WHATSAPP_PHONE"]),
  })
  .strict();

export const whatsappOutboundEnvelopeSchema = createQueueEnvelopeSchema(
  whatsappOutboundPayloadSchema,
).extend({
  eventType: z.literal("whatsapp.message.send"),
});

export type WhatsappOutboundEnvelope = z.infer<typeof whatsappOutboundEnvelopeSchema>;
