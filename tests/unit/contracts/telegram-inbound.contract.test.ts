import { describe, expect, it } from "vitest";

import { telegramInboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-inbound.contract.js";

describe("telegramInboundEnvelopeSchema", () => {
  it("rejects a non-Telegram event type", () => {
    expect(
      telegramInboundEnvelopeSchema.safeParse({
        correlationId: "cor_test",
        eventId: "evt_test",
        eventType: "whatsapp.update.received",
        occurredAt: "2026-07-25T15:00:00.000Z",
        payload: {
          update: {
            update_id: 1,
          },
        },
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });
});
