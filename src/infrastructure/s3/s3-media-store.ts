import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  EnrichmentMediaReader,
  MediaBinaryReader,
  MediaObjectDeleter,
  MediaReference,
  MediaUrlSigner,
  OutboundImageImporter,
} from "../../application/ports/media.js";
import { audioMimeTypeSchema, type AudioMimeType } from "../../contracts/shared/audio.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class S3MediaStore
  implements
    EnrichmentMediaReader,
    MediaBinaryReader,
    MediaObjectDeleter,
    MediaUrlSigner,
    OutboundImageImporter
{
  readonly #bucket: string;
  readonly #client: S3Client;
  readonly #fetch: typeof globalThis.fetch;
  readonly #urlTtlSeconds: number;

  public constructor(
    client: S3Client,
    config: {
      bucket: string;
      fetch?: typeof globalThis.fetch;
      urlTtlSeconds?: number;
    },
  ) {
    this.#bucket = config.bucket;
    this.#client = client;
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#urlTtlSeconds = config.urlTtlSeconds ?? 300;
  }

  public async importImage(input: {
    acceptedMimeTypes?: string[];
    applicationId: string;
    maxSizeBytes?: number;
    mediaId?: string;
    messageId: string;
    sourceUrl?: string;
    tenantId: string;
  }): Promise<MediaReference> {
    const maxSizeBytes = Math.min(input.maxSizeBytes ?? MAX_IMAGE_BYTES, MAX_IMAGE_BYTES);
    if (input.sourceUrl !== undefined) {
      const response = await this.#downloadPublicImage(input.sourceUrl);
      if (!response.ok) throw invalidImage("The image URL could not be downloaded.");
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (declaredLength > maxSizeBytes) {
        throw invalidImage("The image exceeds the provider size limit.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mimeType = normalizeImageType(response.headers.get("content-type"), bytes);
      assertOutboundImageConstraints(
        mimeType,
        bytes.byteLength,
        input.acceptedMimeTypes,
        maxSizeBytes,
      );
      return this.putImage({ ...input, bytes, mimeType, provider: "OUTBOUND" });
    }

    const tenantPrefix = `tenants/${encodeURIComponent(input.tenantId)}/`;
    if (!input.mediaId?.startsWith(tenantPrefix)) {
      throw invalidImage("mediaId must be a media object key returned by this gateway.");
    }

    const response = await this.#client.send(
      new HeadObjectCommand({ Bucket: this.#bucket, Key: input.mediaId }),
    );
    const mimeType = normalizeImageType(response.ContentType, undefined);
    const sizeBytes = response.ContentLength ?? 0;
    const sha256 = response.Metadata?.sha256;
    if (
      sizeBytes <= 0 ||
      sizeBytes > MAX_IMAGE_BYTES ||
      sha256 === undefined ||
      response.Metadata?.applicationid !== input.applicationId ||
      response.Metadata.tenantid !== input.tenantId
    ) {
      throw invalidImage("The stored image metadata is invalid.");
    }
    assertOutboundImageConstraints(mimeType, sizeBytes, input.acceptedMimeTypes, maxSizeBytes);
    return { bucket: this.#bucket, key: input.mediaId, mimeType, sha256, sizeBytes };
  }

  public async readImage(media: MediaReference): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }> {
    return this.#readImage(media);
  }

  async #readImage(
    media: MediaReference,
    ownership?: { applicationId: string; tenantId: string },
  ): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }> {
    if (media.bucket !== this.#bucket) {
      throw invalidImage("The media reference belongs to a different bucket.");
    }
    if (ownership !== undefined) {
      assertOwnedMediaKey(media.key, ownership.tenantId, invalidImage);
    }
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: media.bucket,
        Key: media.key,
      }),
    );
    if (ownership !== undefined) {
      assertOwnedMediaMetadata(response.Metadata, ownership, invalidImage);
    }
    if (response.Body === undefined) {
      throw invalidImage("The stored image could not be read.");
    }
    const bytes = await response.Body.transformToByteArray();
    const mimeType = normalizeImageType(response.ContentType ?? media.mimeType, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.byteLength !== media.sizeBytes ||
      sha256 !== media.sha256 ||
      mimeType !== media.mimeType
    ) {
      throw invalidImage("The stored image no longer matches its media reference.");
    }
    return { bytes, mimeType };
  }

  public async readMedia(input: {
    applicationId: string;
    media: MediaReference;
    tenantId: string;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }> {
    const { media } = input;
    const ownership = { applicationId: input.applicationId, tenantId: input.tenantId };
    if (media.mimeType.startsWith("image/")) return this.#readImage(media, ownership);
    if (media.bucket !== this.#bucket) {
      throw invalidAudio("The media reference belongs to a different bucket.");
    }
    assertOwnedMediaKey(media.key, input.tenantId, invalidAudio);

    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: media.bucket,
        Key: media.key,
      }),
    );
    assertOwnedMediaMetadata(response.Metadata, ownership, invalidAudio);
    if (response.Body === undefined) {
      throw invalidAudio("The stored audio could not be read.");
    }

    const bytes = await response.Body.transformToByteArray();
    const mimeType = normalizeAudioType(response.ContentType ?? media.mimeType, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (
      bytes.byteLength !== media.sizeBytes ||
      sha256 !== media.sha256 ||
      mimeType !== media.mimeType
    ) {
      throw invalidAudio("The stored audio no longer matches its media reference.");
    }
    return { bytes, mimeType };
  }

  public async putImage(input: {
    applicationId: string;
    bytes: Uint8Array;
    messageId: string;
    mimeType: string;
    provider: "OUTBOUND" | "TELEGRAM" | "WHATSAPP";
    tenantId: string;
  }): Promise<MediaReference> {
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw invalidImage("The image must be between 1 byte and 20 MB.");
    }
    const mimeType = normalizeImageType(input.mimeType, input.bytes);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const date = new Date();
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const key = [
      "tenants",
      encodeURIComponent(input.tenantId),
      input.provider.toLowerCase(),
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
      encodeURIComponent(input.messageId),
      `${sha256}.${extension}`,
    ].join("/");

    await this.#client.send(
      new PutObjectCommand({
        Body: input.bytes,
        Bucket: this.#bucket,
        ContentType: mimeType,
        Key: key,
        Metadata: {
          applicationid: input.applicationId,
          sha256,
          tenantid: input.tenantId,
        },
      }),
    );

    return {
      bucket: this.#bucket,
      key,
      mimeType,
      sha256,
      sizeBytes: input.bytes.byteLength,
    };
  }

  public async putAudio(input: {
    applicationId: string;
    bytes: Uint8Array;
    maxSizeBytes?: number;
    messageId: string;
    mimeType: string;
    provider: "TELEGRAM" | "WHATSAPP";
    tenantId: string;
  }): Promise<MediaReference> {
    const maxSizeBytes = Math.min(input.maxSizeBytes ?? MAX_AUDIO_BYTES, MAX_AUDIO_BYTES);
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > maxSizeBytes) {
      throw invalidAudio(`The audio must be between 1 byte and ${String(maxSizeBytes)} bytes.`);
    }
    const mimeType = normalizeAudioType(input.mimeType, input.bytes);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const date = new Date();
    const extension: Record<AudioMimeType, string> = {
      "audio/aac": "aac",
      "audio/amr": "amr",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/ogg": "ogg",
      "audio/webm": "webm",
    };
    const key = [
      "tenants",
      encodeURIComponent(input.tenantId),
      input.provider.toLowerCase(),
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
      encodeURIComponent(input.messageId),
      `${sha256}.${extension[mimeType]}`,
    ].join("/");

    await this.#client.send(
      new PutObjectCommand({
        Body: input.bytes,
        Bucket: this.#bucket,
        ContentType: mimeType,
        Key: key,
        Metadata: {
          applicationid: input.applicationId,
          sha256,
          tenantid: input.tenantId,
        },
      }),
    );

    return {
      bucket: this.#bucket,
      key,
      mimeType,
      sha256,
      sizeBytes: input.bytes.byteLength,
    };
  }

  public temporaryDownloadUrl(media: MediaReference): Promise<string> {
    if (media.bucket !== this.#bucket) {
      throw new Error("The media reference belongs to a different bucket.");
    }
    return getSignedUrl(
      this.#client,
      new GetObjectCommand({
        Bucket: media.bucket,
        ResponseContentType: media.mimeType,
        Key: media.key,
      }),
      { expiresIn: this.#urlTtlSeconds },
    );
  }

  public async deleteMedia(input: {
    applicationId: string;
    media: MediaReference[];
    tenantId: string;
  }): Promise<void> {
    const tenantPrefix = `tenants/${encodeURIComponent(input.tenantId)}/`;
    const keys = [
      ...new Set(
        input.media.map((item) => {
          if (item.bucket !== this.#bucket || !item.key.startsWith(tenantPrefix)) {
            throw new Error("The media reference cannot be deleted from this bucket.");
          }
          return item.key;
        }),
      ),
    ];

    for (let index = 0; index < keys.length; index += 1_000) {
      const response = await this.#client.send(
        new DeleteObjectsCommand({
          Bucket: this.#bucket,
          Delete: {
            Objects: keys.slice(index, index + 1_000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
      if ((response.Errors?.length ?? 0) > 0) {
        throw new Error("S3 did not delete all conversation media objects.");
      }
    }
  }

  async #downloadPublicImage(sourceUrl: string, redirectCount = 0): Promise<Response> {
    const url = await assertPublicHttpsUrl(sourceUrl);
    const response = await this.#fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location === null || redirectCount >= 3) {
        throw invalidImage("The image URL has an invalid redirect.");
      }
      return this.#downloadPublicImage(new URL(location, url).toString(), redirectCount + 1);
    }
    return response;
  }
}

const normalizeImageType = (
  contentType: string | null | undefined,
  bytes: Uint8Array | undefined,
): string => {
  const declared = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const detected =
    bytes === undefined
      ? undefined
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? "image/jpeg"
        : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
          ? "image/png"
          : bytes[0] === 0x52 &&
              bytes[1] === 0x49 &&
              bytes[2] === 0x46 &&
              bytes[3] === 0x46 &&
              bytes[8] === 0x57 &&
              bytes[9] === 0x45 &&
              bytes[10] === 0x42 &&
              bytes[11] === 0x50
            ? "image/webp"
            : undefined;
  const mimeType = detected ?? declared;
  if (bytes !== undefined && detected === undefined) {
    throw invalidImage("The file contents are not a supported image.");
  }
  if (mimeType === undefined || !ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw invalidImage("Only JPEG, PNG, and WebP images are accepted.");
  }
  if (detected !== undefined && declared?.startsWith("image/") === true && detected !== declared) {
    throw invalidImage("The image MIME type does not match its contents.");
  }
  return mimeType;
};

const invalidImage = (message: string): ApplicationError =>
  new ApplicationError("MEDIA_INVALID", message, 422);

const invalidAudio = (message: string): ApplicationError =>
  new ApplicationError("MEDIA_INVALID", message, 422);

const assertOwnedMediaKey = (
  key: string,
  tenantId: string,
  invalid: (message: string) => ApplicationError,
): void => {
  const tenantPrefix = `tenants/${encodeURIComponent(tenantId)}/`;
  if (!key.startsWith(tenantPrefix)) {
    throw invalid("The media reference belongs to a different tenant.");
  }
};

const assertOwnedMediaMetadata = (
  metadata: Record<string, string> | undefined,
  ownership: { applicationId: string; tenantId: string },
  invalid: (message: string) => ApplicationError,
): void => {
  if (
    metadata?.applicationid !== ownership.applicationId ||
    metadata.tenantid !== ownership.tenantId
  ) {
    throw invalid("The stored media belongs to a different application or tenant.");
  }
};

const normalizeAudioType = (contentType: string, bytes: Uint8Array): AudioMimeType => {
  const declaredValue = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const aliases: Record<string, string> = {
    "application/ogg": "audio/ogg",
    "audio/m4a": "audio/mp4",
    "audio/mp3": "audio/mpeg",
    "audio/opus": "audio/ogg",
    "audio/x-m4a": "audio/mp4",
  };
  const declared =
    declaredValue === undefined ? undefined : (aliases[declaredValue] ?? declaredValue);
  const detected = detectAudioType(bytes);
  const parsed = audioMimeTypeSchema.safeParse(detected ?? declared);
  if (!parsed.success) {
    throw invalidAudio("Only AAC, AMR, MP3, M4A, OGG/Opus, and WebM audio is accepted.");
  }
  if (
    detected !== undefined &&
    declared !== undefined &&
    audioMimeTypeSchema.safeParse(declared).success &&
    detected !== declared
  ) {
    throw invalidAudio("The audio MIME type does not match its contents.");
  }
  return parsed.data;
};

const detectAudioType = (bytes: Uint8Array): AudioMimeType | undefined => {
  if (asciiPrefix(bytes, "OggS")) return "audio/ogg";
  if (asciiPrefix(bytes, "#!AMR")) return "audio/amr";
  if (asciiPrefix(bytes, "ID3")) return "audio/mpeg";
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "audio/mp4";
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "audio/webm";
  }
  if (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }
  return undefined;
};

const asciiPrefix = (bytes: Uint8Array, value: string): boolean =>
  Array.from(value).every((character, index) => bytes[index] === character.charCodeAt(0));

const assertOutboundImageConstraints = (
  mimeType: string,
  sizeBytes: number,
  acceptedMimeTypes: string[] | undefined,
  maxSizeBytes: number,
): void => {
  if (sizeBytes <= 0 || sizeBytes > maxSizeBytes) {
    throw invalidImage("The image exceeds the provider size limit.");
  }
  if (acceptedMimeTypes !== undefined && !acceptedMimeTypes.includes(mimeType)) {
    throw invalidImage(`The provider does not accept ${mimeType} images.`);
  }
};

const assertPublicHttpsUrl = async (value: string): Promise<URL> => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  ) {
    throw invalidImage("The image URL must be a public HTTPS URL.");
  }
  let addresses: { address: string }[];
  try {
    addresses =
      isIP(url.hostname) === 0
        ? await lookup(url.hostname, { all: true, verbatim: true })
        : [{ address: url.hostname }];
  } catch {
    throw invalidImage("The image URL could not be resolved.");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw invalidImage("The image URL must resolve to a public address.");
  }
  return url;
};

const isPrivateAddress = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized.includes(":")) {
    if (normalized.startsWith("::ffff:")) {
      return isPrivateAddress(normalized.slice("::ffff:".length));
    }
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    );
  }
  const octets = normalized.split(".").map(Number);
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && (octets[1] ?? 0) >= 64 && (octets[1] ?? 0) <= 127) ||
    (octets[0] ?? 0) >= 224
  );
};
