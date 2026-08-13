import { createHash } from "node:crypto";

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type { InboundImageImporter, MediaReference } from "../../application/ports/media.js";
import type { TelegramCredentialReader } from "../../application/ports/telegram-credential-vault.js";
import type { WhatsappCredentialReader } from "../../application/ports/whatsapp-credential-vault.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import type { S3MediaStore } from "../s3/s3-media-store.js";

const integrationSchema = z.looseObject({
  applicationId: z.string().min(1),
  graphApiVersion: z.string().min(1).optional(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerConnectionId: z.string().min(1),
  status: z.literal("ACTIVE"),
  tenantId: z.string().min(1),
});

const telegramFileResponseSchema = z.looseObject({
  ok: z.literal(true),
  result: z.looseObject({
    file_path: z.string().min(1),
  }),
});

const whatsappMediaResponseSchema = z.looseObject({
  mime_type: z.string().optional(),
  url: z.url(),
});

const TELEGRAM_MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const WHATSAPP_MAX_AUDIO_BYTES = 16 * 1024 * 1024;

export class ProviderInboundImageImporter implements InboundImageImporter {
  readonly #controlTable: string;
  readonly #dynamo: DynamoDBDocumentClient;
  readonly #fetch: typeof globalThis.fetch;
  readonly #media: S3MediaStore;
  readonly #telegramCredentials: TelegramCredentialReader;
  readonly #whatsappCredentials: WhatsappCredentialReader;

  public constructor(
    dynamo: DynamoDBDocumentClient,
    telegramCredentials: TelegramCredentialReader,
    whatsappCredentials: WhatsappCredentialReader,
    media: S3MediaStore,
    config: { controlTable: string; fetch?: typeof globalThis.fetch },
  ) {
    this.#controlTable = config.controlTable;
    this.#dynamo = dynamo;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#media = media;
    this.#telegramCredentials = telegramCredentials;
    this.#whatsappCredentials = whatsappCredentials;
  }

  public async importTelegramImage(input: {
    applicationId: string;
    fileId: string;
    integrationId: string;
    messageId: string;
    tenantId: string;
  }): Promise<MediaReference> {
    const integration = await this.#getIntegration(input, "TELEGRAM");
    const credential = await this.#telegramCredentials.get(integration.providerConnectionId);
    const metadataResponse = await this.#fetch(
      `https://api.telegram.org/bot${encodeURIComponent(credential.botToken)}/getFile?file_id=${encodeURIComponent(input.fileId)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const metadata = telegramFileResponseSchema.safeParse(await metadataResponse.json());
    if (!metadataResponse.ok || !metadata.success) throw providerMediaUnavailable("Telegram");

    const fileResponse = await this.#fetch(
      `https://api.telegram.org/file/bot${encodeURIComponent(credential.botToken)}/${metadata.data.result.file_path}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!fileResponse.ok) throw providerMediaUnavailable("Telegram");
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    return this.#media.putImage({
      ...input,
      bytes,
      mimeType: fileResponse.headers.get("content-type") ?? "image/jpeg",
      provider: "TELEGRAM",
    });
  }

  public async importTelegramAudio(input: {
    applicationId: string;
    fileId: string;
    integrationId: string;
    messageId: string;
    mimeType?: string;
    tenantId: string;
  }): Promise<MediaReference> {
    const integration = await this.#getIntegration(input, "TELEGRAM");
    const credential = await this.#telegramCredentials.get(integration.providerConnectionId);
    const metadataResponse = await this.#fetch(
      `https://api.telegram.org/bot${encodeURIComponent(credential.botToken)}/getFile?file_id=${encodeURIComponent(input.fileId)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const metadata = telegramFileResponseSchema.safeParse(await metadataResponse.json());
    if (!metadataResponse.ok || !metadata.success) throw providerMediaUnavailable("Telegram");

    const fileResponse = await this.#fetch(
      `https://api.telegram.org/file/bot${encodeURIComponent(credential.botToken)}/${metadata.data.result.file_path}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!fileResponse.ok) throw providerMediaUnavailable("Telegram");
    assertDeclaredSize(fileResponse, TELEGRAM_MAX_AUDIO_BYTES, "Telegram audio");
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    return this.#media.putAudio({
      ...input,
      bytes,
      maxSizeBytes: TELEGRAM_MAX_AUDIO_BYTES,
      mimeType:
        input.mimeType ?? fileResponse.headers.get("content-type") ?? "application/octet-stream",
      provider: "TELEGRAM",
    });
  }

  public async importWhatsappImage(input: {
    applicationId: string;
    integrationId: string;
    mediaId: string;
    messageId: string;
    mimeType?: string;
    providerSha256?: string;
    tenantId: string;
  }): Promise<MediaReference> {
    const integration = await this.#getIntegration(input, "WHATSAPP");
    const credential = await this.#whatsappCredentials.get(integration.providerConnectionId);
    const graphApiVersion = integration.graphApiVersion ?? "v23.0";
    const metadataResponse = await this.#fetch(
      `https://graph.facebook.com/${encodeURIComponent(graphApiVersion)}/${encodeURIComponent(input.mediaId)}`,
      {
        headers: { authorization: `Bearer ${credential.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const metadata = whatsappMediaResponseSchema.safeParse(await metadataResponse.json());
    if (!metadataResponse.ok || !metadata.success) throw providerMediaUnavailable("WhatsApp");

    const fileResponse = await this.#fetch(metadata.data.url, {
      headers: { authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!fileResponse.ok) throw providerMediaUnavailable("WhatsApp");
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (
      input.providerSha256 !== undefined &&
      createHash("sha256").update(bytes).digest("base64") !== input.providerSha256
    ) {
      throw new ApplicationError("MEDIA_INVALID", "The WhatsApp image checksum is invalid.", 422);
    }
    return this.#media.putImage({
      ...input,
      bytes,
      mimeType:
        input.mimeType ??
        metadata.data.mime_type ??
        fileResponse.headers.get("content-type") ??
        "image/jpeg",
      provider: "WHATSAPP",
    });
  }

  public async importWhatsappAudio(input: {
    applicationId: string;
    integrationId: string;
    mediaId: string;
    messageId: string;
    mimeType?: string;
    providerSha256?: string;
    tenantId: string;
  }): Promise<MediaReference> {
    const integration = await this.#getIntegration(input, "WHATSAPP");
    const credential = await this.#whatsappCredentials.get(integration.providerConnectionId);
    const graphApiVersion = integration.graphApiVersion ?? "v23.0";
    const metadataResponse = await this.#fetch(
      `https://graph.facebook.com/${encodeURIComponent(graphApiVersion)}/${encodeURIComponent(input.mediaId)}`,
      {
        headers: { authorization: `Bearer ${credential.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const metadata = whatsappMediaResponseSchema.safeParse(await metadataResponse.json());
    if (!metadataResponse.ok || !metadata.success) throw providerMediaUnavailable("WhatsApp");

    const fileResponse = await this.#fetch(metadata.data.url, {
      headers: { authorization: `Bearer ${credential.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!fileResponse.ok) throw providerMediaUnavailable("WhatsApp");
    assertDeclaredSize(fileResponse, WHATSAPP_MAX_AUDIO_BYTES, "WhatsApp audio");
    const bytes = new Uint8Array(await fileResponse.arrayBuffer());
    if (
      input.providerSha256 !== undefined &&
      createHash("sha256").update(bytes).digest("base64") !== input.providerSha256
    ) {
      throw new ApplicationError("MEDIA_INVALID", "The WhatsApp audio checksum is invalid.", 422);
    }
    return this.#media.putAudio({
      ...input,
      bytes,
      maxSizeBytes: WHATSAPP_MAX_AUDIO_BYTES,
      mimeType:
        input.mimeType ??
        metadata.data.mime_type ??
        fileResponse.headers.get("content-type") ??
        "application/octet-stream",
      provider: "WHATSAPP",
    });
  }

  async #getIntegration(
    input: { applicationId: string; integrationId: string; tenantId: string },
    provider: "TELEGRAM" | "WHATSAPP",
  ): Promise<z.infer<typeof integrationSchema>> {
    const response = await this.#dynamo.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
        TableName: this.#controlTable,
      }),
    );
    const parsed = integrationSchema.safeParse(response.Item);
    if (
      !parsed.success ||
      parsed.data.applicationId !== input.applicationId ||
      parsed.data.tenantId !== input.tenantId ||
      parsed.data.provider !== provider
    ) {
      throw new ApplicationError("INTEGRATION_NOT_FOUND", "The integration was not found.", 404);
    }
    return parsed.data;
  }
}

const providerMediaUnavailable = (provider: string): ApplicationError =>
  new ApplicationError(
    "PROVIDER_UNAVAILABLE",
    `${provider} media is temporarily unavailable.`,
    503,
    true,
  );

const assertDeclaredSize = (response: Response, maxSizeBytes: number, label: string): void => {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maxSizeBytes) {
    throw new ApplicationError("MEDIA_INVALID", `${label} exceeds the size limit.`, 422);
  }
};
