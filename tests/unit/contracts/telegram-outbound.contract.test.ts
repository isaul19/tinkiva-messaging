import { describe, expect, it } from "vitest";

import { telegramOutboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-outbound.contract.js";

const validEnvelope = {
  applicationId: "app_demo",
  correlationId: "cor_demo",
  eventId: "evt_demo",
  eventType: "telegram.message.send",
  integrationId: "int_demo",
  occurredAt: "2026-07-25T12:00:00.000Z",
  payload: {
    chatId: "-100123",
    content: {
      text: { body: "Hola" },
      type: "TEXT",
    },
    conversationId: "conv_demo",
    messageId: "msg_demo",
  },
  schemaVersion: 1,
  tenantId: "tenant_demo",
};

describe("Telegram outbound contract", () => {
  it("accepts a text send command", () => {
    expect(telegramOutboundEnvelopeSchema.parse(validEnvelope)).toEqual(validEnvelope);
  });

  it("rejects a non-numeric chat ID", () => {
    expect(() =>
      telegramOutboundEnvelopeSchema.parse({
        ...validEnvelope,
        payload: {
          ...validEnvelope.payload,
          chatId: "@username",
        },
      }),
    ).toThrow();
  });

  it("rejects another event type", () => {
    expect(() =>
      telegramOutboundEnvelopeSchema.parse({
        ...validEnvelope,
        eventType: "telegram.message.sent",
      }),
    ).toThrow();
  });
});
