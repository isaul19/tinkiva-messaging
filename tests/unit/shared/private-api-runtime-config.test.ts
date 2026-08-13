import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadPrivateApiRuntimeConfig } from "../../../src/shared/config/private-api-runtime-config.js";

const environment = {
  CONTROL_TABLE: "messaging-control-test",
  DATA_TABLE: "messaging-data-test",
  MEDIA_BUCKET: "media-test",
  PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
  REALTIME_TICKET_TTL_SECONDS: "60",
  REALTIME_WEBSOCKET_URL: "wss://realtime.example/test",
  STAGE: "test",
  TELEGRAM_OUTBOUND_QUEUE_URL: "https://sqs.example/telegram",
  TELEGRAM_WEBHOOK_BASE_URL: "https://gateway.example",
  TINKIVA_INTEGRATIONS_TABLE: "tenant-integrations-test",
  WHATSAPP_GRAPH_API_VERSION: "v25.0",
  WHATSAPP_OUTBOUND_QUEUE_URL: "https://sqs.example/whatsapp",
  WHATSAPP_WEBHOOK_BASE_URL: "https://gateway.example",
};

describe("private API runtime configuration", () => {
  it("loads Telegram and WhatsApp onboarding and outbound settings", () => {
    expect(loadPrivateApiRuntimeConfig(environment)).toEqual({
      ...environment,
      MEDIA_URL_TTL_SECONDS: 300,
      REALTIME_TICKET_TTL_SECONDS: 60,
    });
  });

  it("rejects an invalid webhook base URL", () => {
    expect(() =>
      loadPrivateApiRuntimeConfig({
        ...environment,
        TELEGRAM_WEBHOOK_BASE_URL: "invalid",
      }),
    ).toThrow(z.ZodError);
  });
});
