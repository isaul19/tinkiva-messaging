import { describe, expect, it } from "vitest";

import type {
  PersistTelegramTextMessage,
  TelegramMessageStore,
} from "../../../src/application/ports/telegram-message-store.js";
import { ProcessTelegramUpdate } from "../../../src/application/telegram/process-telegram-update.js";
import { telegramInboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-inbound.contract.js";

class CapturingStore implements TelegramMessageStore {
  public input: PersistTelegramTextMessage | undefined;

  public persistTextMessage(input: PersistTelegramTextMessage): Promise<"CREATED"> {
    this.input = input;
    return Promise.resolve("CREATED");
  }
}

const createEnvelope = (includeApplication = true) =>
  telegramInboundEnvelopeSchema.parse({
    ...(includeApplication ? { applicationId: "app_test" } : {}),
    correlationId: "cor_optional",
    eventId: "evt_optional",
    eventType: "telegram.update.received",
    integrationId: "int_telegram",
    occurredAt: "2026-07-25T15:00:00.000Z",
    payload: {
      update: {
        edited_message: {
          chat: {
            id: 42,
            type: "private",
          },
          date: 1_785_000_000,
          message_id: 3,
          text: "Edited text without sender metadata",
        },
        update_id: 3,
      },
    },
    schemaVersion: 1,
    tenantId: "tenant_test",
  });

describe("ProcessTelegramUpdate optional Telegram fields", () => {
  it("processes edited private messages without from, username, or chat title", async () => {
    const store = new CapturingStore();

    await new ProcessTelegramUpdate(store).execute(createEnvelope());

    expect(store.input).toMatchObject({
      chatId: "42",
      chatType: "private",
      text: "Edited text without sender metadata",
    });
    expect(store.input?.chatTitle).toBeUndefined();
    expect(store.input?.displayName).toBeUndefined();
    expect(store.input?.senderUserId).toBeUndefined();
    expect(store.input?.username).toBeUndefined();
  });

  it("rejects an envelope missing mandatory application context", async () => {
    await expect(
      new ProcessTelegramUpdate(new CapturingStore()).execute(createEnvelope(false)),
    ).rejects.toThrow("applicationId");
  });
});
