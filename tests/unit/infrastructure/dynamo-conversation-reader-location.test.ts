import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoConversationReader } from "../../../src/infrastructure/dynamodb/dynamo-conversation-reader.js";

describe("DynamoConversationReader location messages", () => {
  it("returns numeric coordinates without requiring media signing", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          applicationId: "app_test",
          conversationId: "conv_test",
          createdAt: "2026-08-08T12:00:00.000Z",
          identityId: "identity_test",
          integrationId: "int_test",
          lastMessageAt: "2026-08-08T12:00:00.000Z",
          status: "OPEN",
          tenantId: "tenant_test",
        },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            conversationId: "conv_test",
            direction: "INBOUND",
            integrationId: "int_test",
            latitude: 4.711,
            longitude: -74.0721,
            messageId: "msg_test",
            occurredAt: "2026-08-08T12:00:00.000Z",
            provider: "WHATSAPP",
            status: "RECEIVED",
            tenantId: "tenant_test",
            type: "LOCATION",
          },
        ],
      });
    const temporaryDownloadUrl = vi.fn();
    const reader = new DynamoConversationReader(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
      { temporaryDownloadUrl },
    );

    await expect(
      reader.listMessages({
        applicationId: "app_test",
        conversationId: "conv_test",
        limit: 50,
        tenantId: "tenant_test",
      }),
    ).resolves.toEqual({
      items: [
        expect.objectContaining({
          latitude: 4.711,
          longitude: -74.0721,
          type: "LOCATION",
        }),
      ],
    });
    expect(temporaryDownloadUrl).not.toHaveBeenCalled();
  });
});
