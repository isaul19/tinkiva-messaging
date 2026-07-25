import { describe, expect, it } from "vitest";

import type {
  PersistTelegramTextMessage,
  TelegramMessageStore,
} from "../../../src/application/ports/telegram-message-store.js";
import { ProcessTelegramUpdate } from "../../../src/application/telegram/process-telegram-update.js";
import { telegramInboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-inbound.contract.js";

class FakeTelegramMessageStore implements TelegramMessageStore {
  public input: PersistTelegramTextMessage | undefined;
  public result: "CREATED" | "DUPLICATE" = "CREATED";

  public persistTextMessage(input: PersistTelegramTextMessage): Promise<"CREATED" | "DUPLICATE"> {
    this.input = input;
    return Promise.resolve(this.result);
  }
}

const textEnvelope = telegramInboundEnvelopeSchema.parse({
  applicationId: "app_test",
  correlationId: "cor_telegram",
  eventId: "evt_telegram",
  eventType: "telegram.update.received",
  integrationId: "int_telegram",
  occurredAt: "2026-07-25T15:00:00.000Z",
  payload: {
    update: {
      message: {
        chat: {
          id: -100_000,
          title: "Support group",
          type: "supergroup",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Saul",
          id: 42,
          is_bot: false,
          last_name: "Porras",
          username: "mutable_username",
        },
        message_id: 77,
        text: "Hello from Telegram",
      },
      update_id: 9010,
    },
  },
  schemaVersion: 1,
  tenantId: "tenant_test",
});

describe("ProcessTelegramUpdate", () => {
  it("normalizes Telegram chat and sender identities without conflating them", async () => {
    const store = new FakeTelegramMessageStore();
    const useCase = new ProcessTelegramUpdate(store);

    await expect(useCase.execute(textEnvelope)).resolves.toEqual({
      result: "CREATED",
    });

    expect(store.input).toMatchObject({
      applicationId: "app_test",
      chatId: "-100000",
      chatTitle: "Support group",
      displayName: "Saul Porras",
      integrationId: "int_telegram",
      providerMessageId: "77",
      senderUserId: "42",
      tenantId: "tenant_test",
      text: "Hello from Telegram",
      updateId: "9010",
      username: "mutable_username",
    });
    expect(store.input?.conversationId).toMatch(/^conv_[0-9A-Za-z_-]+$/);
    expect(store.input?.messageId).toMatch(/^msg_[0-9A-Za-z_-]+$/);
  });

  it("propagates durable duplicate detection", async () => {
    const store = new FakeTelegramMessageStore();
    store.result = "DUPLICATE";

    await expect(new ProcessTelegramUpdate(store).execute(textEnvelope)).resolves.toEqual({
      result: "DUPLICATE",
    });
  });

  it("acknowledges unsupported non-text updates without persisting", async () => {
    const store = new FakeTelegramMessageStore();
    const envelope = telegramInboundEnvelopeSchema.parse({
      ...textEnvelope,
      eventId: "evt_photo",
      payload: {
        update: {
          message: {
            chat: {
              id: 42,
              type: "private",
            },
            date: 1_785_000_000,
            message_id: 78,
            photo: [
              {
                file_id: "file_01",
                file_unique_id: "unique_01",
                height: 100,
                width: 100,
              },
            ],
          },
          update_id: 9011,
        },
      },
    });

    await expect(new ProcessTelegramUpdate(store).execute(envelope)).resolves.toEqual({
      result: "IGNORED",
    });
    expect(store.input).toBeUndefined();
  });
});
