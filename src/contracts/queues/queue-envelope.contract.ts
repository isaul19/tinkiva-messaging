import { z } from "zod";

import {
  applicationIdSchema,
  correlationIdSchema,
  eventIdSchema,
  integrationIdSchema,
  tenantIdSchema,
} from "../shared/identifiers.js";

export const createQueueEnvelopeSchema = <TPayload extends z.ZodType>(payloadSchema: TPayload) =>
  z
    .object({
      applicationId: applicationIdSchema.optional(),
      causationId: eventIdSchema.optional(),
      correlationId: correlationIdSchema,
      eventId: eventIdSchema,
      eventType: z.string().trim().min(1).max(120),
      integrationId: integrationIdSchema.optional(),
      occurredAt: z.iso.datetime({ offset: true }),
      payload: payloadSchema,
      schemaVersion: z.literal(1),
      tenantId: tenantIdSchema.optional(),
    })
    .strict();

export const queueEnvelopeSchema = createQueueEnvelopeSchema(z.unknown());

export type QueueEnvelope = z.infer<typeof queueEnvelopeSchema>;
