import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoTelegramMessageStore } from "../../../src/infrastructure/dynamodb/dynamo-telegram-message-store.js";
import { DynamoWhatsappMessageStore } from "../../../src/infrastructure/dynamodb/dynamo-whatsapp-message-store.js";

const persistedMessage = (send: ReturnType<typeof vi.fn>) => {
  const command = send.mock.calls[0]?.[0] as TransactWriteCommand | undefined;
  return command?.input.TransactItems?.map((item) => item.Put?.Item).find(
    (item) => item?.entityType === "MESSAGE",
  );
};

describe("Dynamo location message stores", () => {
  it("persists a normalized Telegram location", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoTelegramMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
    );

    await expect(
      store.persistLocationMessage({
        applicationId: "app_test",
        chatId: "123",
        chatType: "private",
        conversationId: "conv_test",
        integrationId: "int_test",
        latitude: 4.711,
        longitude: -74.0721,
        messageId: "msg_test",
        occurredAt: "2026-08-08T12:00:00.000Z",
        providerMessageId: "77",
        tenantId: "tenant_test",
        updateId: "9001",
      }),
    ).resolves.toBe("CREATED");
    expect(persistedMessage(send)).toMatchObject({
      latitude: 4.711,
      longitude: -74.0721,
      provider: "TELEGRAM",
      type: "LOCATION",
    });
  });

  it("persists a normalized WhatsApp location", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoWhatsappMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
    );

    await expect(
      store.persistLocationMessage({
        applicationId: "app_test",
        canonicalType: "WHATSAPP_PHONE",
        canonicalValue: "573001112233",
        integrationId: "int_test",
        latitude: 4.711,
        longitude: -74.0721,
        messageId: "msg_test",
        occurredAt: "2026-08-08T12:00:00.000Z",
        phoneE164: "+573001112233",
        providerMessageId: "wamid.location",
        tenantId: "tenant_test",
      }),
    ).resolves.toBe("CREATED");
    expect(persistedMessage(send)).toMatchObject({
      latitude: 4.711,
      longitude: -74.0721,
      provider: "WHATSAPP",
      type: "LOCATION",
    });
  });
});
