import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoTelegramIntegrationStore } from "../../../src/infrastructure/dynamodb/dynamo-telegram-integration-store.js";

describe("DynamoTelegramIntegrationStore", () => {
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
