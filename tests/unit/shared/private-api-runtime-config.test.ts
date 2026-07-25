import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadPrivateApiRuntimeConfig } from "../../../src/shared/config/private-api-runtime-config.js";

const environment = {
  CONTROL_TABLE: "messaging-control-test",
  DATA_TABLE: "messaging-data-test",
  STAGE: "test",
  TELEGRAM_OUTBOUND_QUEUE_URL: "https://sqs.example/telegram",
  TELEGRAM_WEBHOOK_BASE_URL: "https://gateway.example",
};

describe("private API runtime configuration", () => {
  it("loads Telegram onboarding and outbound settings", () => {
    expect(loadPrivateApiRuntimeConfig(environment)).toEqual(environment);
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
