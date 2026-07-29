import { z } from "zod";

import { messageContentSchema } from "../api/message.contract.js";
import { conversationIdSchema, messageIdSchema } from "../shared/identifiers.js";
import { createQueueEnvelopeSchema } from "./queue-envelope.contract.js";

export const telegramOutboundPayloadSchema = z
  .object({
    chatId: z.string().regex(/^-?\d+$/),
    content: messageContentSchema,
    conversationId: conversationIdSchema,
    messageId: messageIdSchema,
  })
  .strict();

export const telegramOutboundEnvelopeSchema = createQueueEnvelopeSchema(
  telegramOutboundPayloadSchema,
).refine((envelope) => envelope.eventType === "telegram.message.send", {
  message: "Expected a Telegram outbound command.",
});

export type TelegramOutboundEnvelope = z.infer<typeof telegramOutboundEnvelopeSchema>;
