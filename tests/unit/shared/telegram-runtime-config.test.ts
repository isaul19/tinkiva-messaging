import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadTelegramWebhookRuntimeConfig } from "../../../src/shared/config/telegram-webhook-runtime-config.js";

const environment = {
  CONTROL_TABLE: "messaging-control-test",
  INBOUND_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/inbound.fifo",
  PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
  STAGE: "test",
};

describe("Telegram webhook runtime configuration", () => {
  it("loads queue, table, stage, and KMS boundaries", () => {
    expect(loadTelegramWebhookRuntimeConfig(environment)).toEqual(environment);
  });

  it("rejects missing or invalid queue configuration", () => {
    expect(() =>
      loadTelegramWebhookRuntimeConfig({
        ...environment,
        INBOUND_QUEUE_URL: "not-a-url",
      }),
    ).toThrow(z.ZodError);
  });
});
