import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoConversationReader } from "../../../src/infrastructure/dynamodb/dynamo-conversation-reader.js";

describe("DynamoConversationReader audio messages", () => {
  it("returns audio metadata with a temporary playback URL", async () => {
    const storedMedia = {
      bucket: "media-test",
      key: "tenants/tenant_test/whatsapp/2026/08/08/msg_test/audio.ogg",
      mimeType: "audio/ogg",
      sha256: "a".repeat(64),
      sizeBytes: 1_024,
    };
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
            media: storedMedia,
            messageId: "msg_test",
            occurredAt: "2026-08-08T12:00:00.000Z",
            provider: "WHATSAPP",
            status: "RECEIVED",
            tenantId: "tenant_test",
            type: "AUDIO",
            voice: true,
          },
        ],
      });
    const temporaryDownloadUrl = vi.fn().mockResolvedValue("https://signed.example/audio.ogg");
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
          media: {
            mediaId: storedMedia.key,
            mimeType: "audio/ogg",
            sha256: storedMedia.sha256,
            sizeBytes: storedMedia.sizeBytes,
            url: "https://signed.example/audio.ogg",
          },
          type: "AUDIO",
          voice: true,
        }),
      ],
    });
    expect(temporaryDownloadUrl).toHaveBeenCalledWith(storedMedia);
  });
});
