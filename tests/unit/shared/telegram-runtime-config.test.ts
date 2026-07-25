import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadTelegramWebhookRuntimeConfig } from "../../../src/shared/config/telegram-webhook-runtime-config.js";

describe("Telegram webhook runtime configuration", () => {
  it("loads queue and table boundaries", () => {
    expect(
      loadTelegramWebhookRuntimeConfig({
        CONTROL_TABLE: "messaging-control-test",
        INBOUND_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/inbound.fifo",
      }),
    ).toEqual({
      CONTROL_TABLE: "messaging-control-test",
      INBOUND_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/inbound.fifo",
    });
  });

  it("rejects missing or invalid queue configuration", () => {
    expect(() =>
      loadTelegramWebhookRuntimeConfig({
        CONTROL_TABLE: "messaging-control-test",
        INBOUND_QUEUE_URL: "not-a-url",
      }),
    ).toThrow(z.ZodError);
  });
});
