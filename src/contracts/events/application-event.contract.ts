import { z } from "zod";

import { applicationIdSchema, eventIdSchema, tenantIdSchema } from "../shared/identifiers.js";

export const applicationEventTypeSchema = z.enum([
  "conversation.created",
  "conversation.updated",
  "integration.connected",
  "integration.disconnected",
  "integration.status_changed",
  "media.ready",
  "message.delivered",
  "message.failed",
  "message.queued",
  "message.read",
  "message.received",
  "message.sent",
]);

export const createApplicationEventSchema = <TData extends z.ZodType>(dataSchema: TData) =>
  z
    .object({
      applicationId: applicationIdSchema,
      data: dataSchema,
      eventId: eventIdSchema,
      occurredAt: z.iso.datetime({ offset: true }),
      schemaVersion: z.literal(1),
      tenantId: tenantIdSchema,
      type: applicationEventTypeSchema,
    })
    .strict();

export const applicationEventSchema = createApplicationEventSchema(
  z.record(z.string(), z.unknown()),
);

export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
export type ApplicationEventType = z.infer<typeof applicationEventTypeSchema>;
