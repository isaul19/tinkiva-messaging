import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  MediaBinaryReader,
  MediaReference,
  MediaUrlSigner,
  OutboundImageImporter,
} from "../../application/ports/media.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class S3MediaStore implements MediaBinaryReader, MediaUrlSigner, OutboundImageImporter {
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

    if (!input.mediaId?.startsWith("tenants/")) {
      throw invalidImage("mediaId must be a media object key returned by this gateway.");
    }

    const response = await this.#client.send(
      new HeadObjectCommand({ Bucket: this.#bucket, Key: input.mediaId }),
    );
    const mimeType = normalizeImageType(response.ContentType, undefined);
    const sizeBytes = response.ContentLength ?? 0;
    const sha256 = response.Metadata?.sha256;
    if (sizeBytes <= 0 || sizeBytes > MAX_IMAGE_BYTES || sha256 === undefined) {
      throw invalidImage("The stored image metadata is invalid.");
    }
    assertOutboundImageConstraints(mimeType, sizeBytes, input.acceptedMimeTypes, maxSizeBytes);
    return { bucket: this.#bucket, key: input.mediaId, mimeType, sha256, sizeBytes };
  }

  public async readImage(media: MediaReference): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }> {
    if (media.bucket !== this.#bucket) {
      throw invalidImage("The media reference belongs to a different bucket.");
    }
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: media.bucket,
        Key: media.key,
      }),
    );
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
