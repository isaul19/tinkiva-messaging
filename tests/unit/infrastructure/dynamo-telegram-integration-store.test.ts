import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoTelegramIntegrationStore } from "../../../src/infrastructure/dynamodb/dynamo-telegram-integration-store.js";

const persistedIntegration = (send: ReturnType<typeof vi.fn>) => {
  const command = send.mock.calls[0]?.[0] as TransactWriteCommand | undefined;
  return command?.input.TransactItems?.map((item) => item.Put?.Item).find(
    (item) => item?.entityType === "CHANNEL_INTEGRATION",
  );
};

describe("DynamoTelegramIntegrationStore", () => {
  it("persists inbound media settings on the integration metadata", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoTelegramIntegrationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "messaging-control-test",
    );

    await store.createPending({
      applicationId: "app_test",
      botId: "bot_test",
      createdAt: "2026-07-28T00:00:00.000Z",
      credentialRef: "credential_test",
      displayName: "Test bot",
      inboundMedia: {
        audioAlternativeText: true,
        imageAlternativeText: false,
      },
      integrationId: "int_test",
      providerConnectionId: "pc_test",
      tenantId: "tenant_test",
      webhookKey: "webhook_test",
      webhookUrl: "https://example.test/webhooks/telegram/webhook_test",
    });

    expect(persistedIntegration(send)).toMatchObject({
      inboundMedia: {
        audioAlternativeText: true,
        imageAlternativeText: false,
      },
      integrationId: "int_test",
    });
  });

  it("returns a public conflict when the bot is already registered", async () => {
    const send = vi.fn().mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
        message: "Transaction cancelled",
      }),
    );
    const store = new DynamoTelegramIntegrationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "messaging-control-test",
    );

    await expect(
      store.createPending({
        applicationId: "app_test",
        botId: "bot_test",
        botUsername: "test_bot",
        createdAt: "2026-07-28T00:00:00.000Z",
        credentialRef: "credential_test",
        displayName: "Test bot",
        inboundMedia: {
          audioAlternativeText: false,
          imageAlternativeText: false,
        },
        integrationId: "int_test",
        providerConnectionId: "pc_test",
        tenantId: "tenant_test",
        webhookKey: "webhook_test",
        webhookUrl: "https://example.test/webhooks/telegram/webhook_test",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CONFIGURATION_INVALID",
      message: "El bot de Telegram ya fue registrado.",
      statusCode: 409,
    });
  });
});
