import { createHash } from "node:crypto";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import type { TelegramCredentialReader } from "../../../src/application/ports/telegram-credential-vault.js";
import type { WhatsappCredentialReader } from "../../../src/application/ports/whatsapp-credential-vault.js";
import { ProviderInboundImageImporter } from "../../../src/infrastructure/media/provider-inbound-image-importer.js";
import type { S3MediaStore } from "../../../src/infrastructure/s3/s3-media-store.js";

const audioBytes = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
const mediaReference = {
  bucket: "media-bucket",
  key: "tenants/tenant_test/telegram/audio.ogg",
  mimeType: "audio/ogg",
  sha256: createHash("sha256").update(audioBytes).digest("hex"),
  sizeBytes: audioBytes.byteLength,
};

describe("ProviderInboundImageImporter audio", () => {
  it("downloads Telegram audio and applies the 20 MB provider limit", async () => {
    const dynamo = dynamoReturning({
      applicationId: "app_test",
      provider: "TELEGRAM",
      providerConnectionId: "telegram_connection",
      status: "ACTIVE",
      tenantId: "tenant_test",
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ ok: true, result: { file_path: "voice/file_1.oga" } }))
      .mockResolvedValueOnce(
        new Response(audioBytes, {
          headers: {
            "content-length": String(audioBytes.byteLength),
            "content-type": "audio/ogg",
          },
        }),
      );
    const putAudio = vi.fn().mockResolvedValue(mediaReference);
    const importer = createImporter({ dynamo, fetch, putAudio });

    const result = await importer.importTelegramAudio({
      applicationId: "app_test",
      fileId: "telegram_file_1",
      integrationId: "integration_test",
      messageId: "message_test",
      tenantId: "tenant_test",
    });

    expect(result).toEqual(mediaReference);
    expect(putAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: audioBytes,
        maxSizeBytes: 20 * 1024 * 1024,
        mimeType: "audio/ogg",
        provider: "TELEGRAM",
      }),
    );
  });

  it("downloads and verifies WhatsApp audio with the 16 MB provider limit", async () => {
    const dynamo = dynamoReturning({
      applicationId: "app_test",
      graphApiVersion: "v23.0",
      provider: "WHATSAPP",
      providerConnectionId: "whatsapp_connection",
      status: "ACTIVE",
      tenantId: "tenant_test",
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ mime_type: "audio/ogg", url: "https://media.example/audio_1" }),
      )
      .mockResolvedValueOnce(
        new Response(audioBytes, {
          headers: { "content-length": String(audioBytes.byteLength) },
        }),
      );
    const putAudio = vi.fn().mockResolvedValue(mediaReference);
    const importer = createImporter({ dynamo, fetch, putAudio });

    const result = await importer.importWhatsappAudio({
      applicationId: "app_test",
      integrationId: "integration_test",
      mediaId: "whatsapp_media_1",
      messageId: "message_test",
      providerSha256: createHash("sha256").update(audioBytes).digest("base64"),
      tenantId: "tenant_test",
    });

    expect(result).toEqual(mediaReference);
    expect(putAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: audioBytes,
        maxSizeBytes: 16 * 1024 * 1024,
        mimeType: "audio/ogg",
        provider: "WHATSAPP",
      }),
    );
  });
});

const dynamoReturning = (Item: Record<string, unknown>): DynamoDBDocumentClient =>
  ({ send: vi.fn().mockResolvedValue({ Item }) }) as unknown as DynamoDBDocumentClient;

const createImporter = (input: {
  dynamo: DynamoDBDocumentClient;
  fetch: typeof globalThis.fetch;
  putAudio: ReturnType<typeof vi.fn>;
}): ProviderInboundImageImporter =>
  new ProviderInboundImageImporter(
    input.dynamo,
    {
      get: vi.fn().mockResolvedValue({
        botToken: "telegram_bot_token",
        webhookSecretToken: "telegram_webhook_secret",
      }),
    } satisfies TelegramCredentialReader,
    {
      get: vi.fn().mockResolvedValue({
        accessToken: "whatsapp_access_token_long_enough",
        appSecret: "whatsapp_app_secret",
        verifyToken: "whatsapp_verify_token_long_enough_123",
      }),
    } satisfies WhatsappCredentialReader,
    { putAudio: input.putAudio } as unknown as S3MediaStore,
    { controlTable: "control-table", fetch: input.fetch },
  );
