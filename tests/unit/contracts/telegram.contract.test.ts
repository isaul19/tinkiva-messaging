import { describe, expect, it } from "vitest";

import {
  telegramSecretSchema,
  telegramUpdateSchema,
} from "../../../src/contracts/providers/telegram.contract.js";

describe("Telegram provider contracts", () => {
  it("accepts Telegram extensions while validating stable routing fields", () => {
    const update = telegramUpdateSchema.parse({
      message: {
        chat: {
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        future_telegram_field: true,
        message_id: 1,
        photo: [
          {
            file_id: "file_01",
            file_unique_id: "unique_01",
            height: 100,
            width: 100,
          },
        ],
      },
      update_id: 1,
    });

    expect(update.message?.chat.id).toBe(42);
  });

  it("rejects updates without update_id and incomplete secrets", () => {
    expect(telegramUpdateSchema.safeParse({ message: {} }).success).toBe(false);
    expect(
      telegramSecretSchema.safeParse({
        botToken: "short",
        webhookSecretToken: "short",
      }).success,
    ).toBe(false);
  });
});
