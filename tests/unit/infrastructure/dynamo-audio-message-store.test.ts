import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoTelegramMessageStore } from "../../../src/infrastructure/dynamodb/dynamo-telegram-message-store.js";
import { DynamoWhatsappMessageStore } from "../../../src/infrastructure/dynamodb/dynamo-whatsapp-message-store.js";

const media = {
  bucket: "media-test",
  key: "tenants/tenant_test/telegram/2026/08/08/msg_test/audio.ogg",
  mimeType: "audio/ogg",
  sha256: "a".repeat(64),
  sizeBytes: 1_024,
};

const persistedMessage = (send: ReturnType<typeof vi.fn>) => {
  const command = send.mock.calls[0]?.[0] as TransactWriteCommand | undefined;
  return command?.input.TransactItems?.map((item) => item.Put?.Item).find(
    (item) => item?.entityType === "MESSAGE",
  );
};

describe("Dynamo audio message stores", () => {
  it("persists Telegram audio metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const publish = vi.fn().mockResolvedValue(undefined);
    const store = new DynamoTelegramMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
      { publish },
    );

    await store.persistAudioMessage({
      applicationId: "app_test",
      alternativeTextRequested: true,
      caption: "Voice note",
      chatId: "123",
      chatType: "private",
      conversationId: "conv_test",
      durationSeconds: 9,
      integrationId: "int_test",
      media,
      messageId: "msg_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      providerMessageId: "78",
      tenantId: "tenant_test",
      updateId: "9002",
      voice: true,
    });

    expect(persistedMessage(send)).toMatchObject({
      caption: "Voice note",
      durationSeconds: 9,
      media,
      metadata: { alternativeTextStatus: "PENDING" },
      provider: "TELEGRAM",
      type: "AUDIO",
      voice: true,
    });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_test",
        media,
        messageId: "msg_test",
        type: "AUDIO",
      }),
    );
  });

  it("re-publishes the exact persisted job after Dynamo succeeds and SQS fails", async () => {
    const duplicate = new TransactionCanceledException({
      $metadata: {},
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
      message: "duplicate",
    });
    const messageSortKey = "MESSAGE#2026-08-08T12:00:00.000Z#msg_test";
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({
        Item: {
          PK: "CONVERSATION#conv_test",
          SK: messageSortKey,
          applicationId: "app_test",
          conversationId: "conv_test",
          direction: "INBOUND",
          entityType: "MESSAGE",
          integrationId: "int_test",
          media,
          messageId: "msg_test",
          metadata: { alternativeTextStatus: "PENDING" },
          tenantId: "tenant_test",
          type: "AUDIO",
        },
      });
    const publishError = new Error("SQS unavailable");
    const publish = vi.fn().mockRejectedValueOnce(publishError).mockResolvedValueOnce(undefined);
    const store = new DynamoTelegramMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
      { publish },
    );

    const input = {
      applicationId: "app_test",
      alternativeTextRequested: true,
      chatId: "123",
      chatType: "private" as const,
      conversationId: "conv_test",
      integrationId: "int_test",
      media,
      messageId: "msg_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      providerMessageId: "78",
      tenantId: "tenant_test",
      updateId: "9002",
      voice: true,
    };

    await expect(store.persistAudioMessage(input)).rejects.toBe(publishError);
    await expect(
      store.persistAudioMessage({
        ...input,
        media: { ...media, key: "tenants/tenant_test/telegram/next-day/audio.ogg" },
      }),
    ).resolves.toBe("DUPLICATE");

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toEqual(publish.mock.calls[0]?.[0]);
    expect(publish.mock.calls[1]?.[0]).toMatchObject({ media, messageSortKey });
  });

  it("does not create PENDING media when the enrichment publisher is missing", async () => {
    const send = vi.fn();
    const store = new DynamoTelegramMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
    );

    await expect(
      store.persistAudioMessage({
        applicationId: "app_test",
        alternativeTextRequested: true,
        chatId: "123",
        chatType: "private",
        conversationId: "conv_test",
        integrationId: "int_test",
        media,
        messageId: "msg_test",
        occurredAt: "2026-08-08T12:00:00.000Z",
        providerMessageId: "78",
        tenantId: "tenant_test",
        updateId: "9002",
        voice: true,
      }),
    ).rejects.toThrow("without a configured job publisher");
    expect(send).not.toHaveBeenCalled();
  });

  it("persists WhatsApp audio metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoWhatsappMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
    );

    await store.persistAudioMessage({
      applicationId: "app_test",
      canonicalType: "WHATSAPP_PHONE",
      canonicalValue: "573001112233",
      integrationId: "int_test",
      media,
      messageId: "msg_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      providerMessageId: "wamid.audio",
      tenantId: "tenant_test",
      voice: false,
    });

    expect(persistedMessage(send)).toMatchObject({
      media,
      provider: "WHATSAPP",
      type: "AUDIO",
      voice: false,
    });
  });
});
