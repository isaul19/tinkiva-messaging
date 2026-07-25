import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadTelegramSenderRuntimeConfig } from "../../../src/shared/config/telegram-sender-runtime-config.js";

const environment = {
  CONTROL_TABLE: "control",
  DATA_TABLE: "data",
  PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
  STAGE: "test",
};

describe("Telegram sender runtime configuration", () => {
  it("loads both tables, stage, and KMS key", () => {
    expect(loadTelegramSenderRuntimeConfig(environment)).toEqual(environment);
  });

  it("rejects a missing data table", () => {
    expect(() =>
      loadTelegramSenderRuntimeConfig({
        CONTROL_TABLE: "control",
        PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
        STAGE: "test",
      }),
    ).toThrow(z.ZodError);
  });
});
