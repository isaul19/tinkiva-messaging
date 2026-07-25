import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createQueueEnvelopeSchema } from "../../../src/contracts/index.js";

const payloadSchema = z
  .object({
    updateId: z.number().int().nonnegative(),
  })
  .strict();

const telegramEnvelopeSchema = createQueueEnvelopeSchema(payloadSchema);

describe("createQueueEnvelopeSchema", () => {
  it("validates a versioned internal event", () => {
    const envelope = telegramEnvelopeSchema.parse({
      correlationId: "cor_01",
      eventId: "evt_01",
      eventType: "telegram.update.received",
      integrationId: "int_bot_01",
      occurredAt: "2026-07-25T16:00:00.000Z",
      payload: {
        updateId: 123,
      },
      schemaVersion: 1,
      tenantId: "tenant_01",
    });

    expect(envelope.payload.updateId).toBe(123);
  });

  it("rejects unversioned envelopes", () => {
    const result = telegramEnvelopeSchema.safeParse({
      correlationId: "cor_01",
      eventId: "evt_01",
      eventType: "telegram.update.received",
      occurredAt: "2026-07-25T16:00:00.000Z",
      payload: {
        updateId: 123,
      },
    });

    expect(result.success).toBe(false);
  });
});
