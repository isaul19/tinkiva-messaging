import { describe, expect, it } from "vitest";

import { sendMessageRequestSchema } from "../../../src/contracts/index.js";

const baseRequest = {
  content: {
    text: {
      body: "Hola",
    },
    type: "TEXT",
  },
  integrationId: "int_primary",
  tenantId: "tenant_demo",
} as const;

describe("sendMessageRequestSchema", () => {
  it("accepts a message targeting an existing conversation", () => {
    const result = sendMessageRequestSchema.safeParse({
      ...baseRequest,
      conversationId: "conv_customer_01",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a stable provider recipient", () => {
    const result = sendMessageRequestSchema.safeParse({
      ...baseRequest,
      recipient: {
        type: "TELEGRAM_CHAT_ID",
        value: "-100123456789",
      },
    });

    expect(result.success).toBe(true);
  });

  it.each([
    {
      caseName: "neither destination",
      request: baseRequest,
    },
    {
      caseName: "both destinations",
      request: {
        ...baseRequest,
        conversationId: "conv_customer_01",
        recipient: {
          type: "WHATSAPP_BSUID",
          value: "US.123456789",
        },
      },
    },
  ])("rejects $caseName", ({ request }) => {
    const result = sendMessageRequestSchema.safeParse(request);

    expect(result.success).toBe(false);
  });
});
