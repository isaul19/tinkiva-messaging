import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadTelegramSenderRuntimeConfig } from "../../../src/shared/config/telegram-sender-runtime-config.js";

describe("Telegram sender runtime configuration", () => {
  it("loads both DynamoDB table names", () => {
    expect(
      loadTelegramSenderRuntimeConfig({
        CONTROL_TABLE: "control",
        DATA_TABLE: "data",
      }),
    ).toEqual({
      CONTROL_TABLE: "control",
      DATA_TABLE: "data",
    });
  });

  it("rejects a missing data table", () => {
    expect(() =>
      loadTelegramSenderRuntimeConfig({
        CONTROL_TABLE: "control",
      }),
    ).toThrow(z.ZodError);
  });
});
