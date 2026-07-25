import { z } from "zod";

import { telegramUpdateSchema } from "../providers/telegram.contract.js";
import { createQueueEnvelopeSchema } from "./queue-envelope.contract.js";

export const telegramInboundPayloadSchema = z.strictObject({
  update: telegramUpdateSchema,
});

export const telegramInboundEnvelopeSchema = createQueueEnvelopeSchema(
  telegramInboundPayloadSchema,
).refine((envelope) => envelope.eventType === "telegram.update.received", {
  message: "Expected a Telegram inbound event.",
  path: ["eventType"],
});

export type TelegramInboundEnvelope = z.infer<typeof telegramInboundEnvelopeSchema>;
