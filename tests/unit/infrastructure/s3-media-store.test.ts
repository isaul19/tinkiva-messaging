import { createHash } from "node:crypto";

import { DeleteObjectsCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { S3MediaStore } from "../../../src/infrastructure/s3/s3-media-store.js";

describe("S3MediaStore binary images", () => {
  it("reads and verifies the canonical S3 image bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const client = {
      send: vi.fn().mockResolvedValue({
        Body: {
          transformToByteArray: vi.fn().mockResolvedValue(bytes),
        },
        ContentType: "image/jpeg",
      }),
    } as unknown as S3Client;
    const store = new S3MediaStore(client, { bucket: "media-test" });

    await expect(
      store.readImage({
        bucket: "media-test",
        key: "tenants/tenant_test/outbound/image.jpg",
        mimeType: "image/jpeg",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sizeBytes: bytes.byteLength,
      }),
    ).resolves.toEqual({
      bytes,
      mimeType: "image/jpeg",
    });
  });

  it("rejects provider-incompatible WebP images before writing them to S3", async () => {
    const bytes = new Uint8Array(12);
    bytes.set(new TextEncoder().encode("RIFF"), 0);
    bytes.set(new TextEncoder().encode("WEBP"), 8);
    const sendMock = vi.fn();
    const client = { send: sendMock } as unknown as S3Client;
    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "image/webp",
        },
        status: 200,
      }),
    );
    const store = new S3MediaStore(client, {
      bucket: "media-test",
      fetch: fetchMock,
    });

    await expect(
      store.importImage({
        acceptedMimeTypes: ["image/jpeg", "image/png"],
        applicationId: "app_test",
        maxSizeBytes: 5 * 1024 * 1024,
        messageId: "msg_test",
        sourceUrl: "https://1.1.1.1/image.webp",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({
      code: "MEDIA_INVALID",
      statusCode: 422,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("accepts stored media IDs only for the exact application and tenant", async () => {
    const send = vi.fn().mockResolvedValue({
      ContentLength: 128,
      ContentType: "image/jpeg",
      Metadata: {
        applicationid: "app_other",
        sha256: "a".repeat(64),
        tenantid: "tenant_test",
      },
    });
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });

    await expect(
      store.importImage({
        applicationId: "app_test",
        mediaId: "tenants/tenant_other/outbound/image.jpg",
        messageId: "msg_test",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID" });
    expect(send).not.toHaveBeenCalled();

    await expect(
      store.importImage({
        applicationId: "app_test",
        mediaId: "tenants/tenant_test/outbound/image.jpg",
        messageId: "msg_test",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID" });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it("reads enrichment media only from its exact tenant and application", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
    const transformToByteArray = vi.fn().mockResolvedValue(bytes);
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray },
      ContentType: "image/jpeg",
      Metadata: {
        applicationid: "app_other",
        tenantid: "tenant_test",
      },
    });
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });
    const media = {
      bucket: "media-test",
      key: "tenants/tenant_test/telegram/image.jpg",
      mimeType: "image/jpeg",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
    };

    await expect(
      store.readMedia({ applicationId: "app_test", media, tenantId: "tenant_test" }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID" });
    expect(transformToByteArray).not.toHaveBeenCalled();

    await expect(
      store.readMedia({
        applicationId: "app_other",
        media: { ...media, key: "tenants/tenant_other/telegram/image.jpg" },
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID" });
    expect(send).toHaveBeenCalledOnce();
  });
});

describe("S3MediaStore binary audio", () => {
  it("stores OGG/Opus audio with canonical metadata", async () => {
    const bytes = new TextEncoder().encode("OggS-test-audio");
    const send = vi.fn().mockResolvedValue({});
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });

    const result = await store.putAudio({
      applicationId: "app_test",
      bytes,
      messageId: "msg_audio",
      mimeType: "audio/ogg; codecs=opus",
      provider: "TELEGRAM",
      tenantId: "tenant_test",
    });

    expect(result).toMatchObject({
      bucket: "media-test",
      mimeType: "audio/ogg",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
    });
    expect(result.key).toMatch(/\.ogg$/);
    expect(send).toHaveBeenCalledOnce();
  });

  it("rejects audio whose declared MIME type conflicts with its bytes", async () => {
    const bytes = new TextEncoder().encode("OggS-test-audio");
    const send = vi.fn();
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });

    await expect(
      store.putAudio({
        applicationId: "app_test",
        bytes,
        messageId: "msg_audio",
        mimeType: "audio/mpeg",
        provider: "WHATSAPP",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "MEDIA_INVALID", statusCode: 422 });
    expect(send).not.toHaveBeenCalled();
  });

  it("verifies canonical ownership metadata before reading enrichment audio", async () => {
    const bytes = new TextEncoder().encode("OggS-test-audio");
    const transformToByteArray = vi.fn().mockResolvedValue(bytes);
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray },
      ContentType: "audio/ogg",
      Metadata: {
        applicationid: "app_test",
        tenantid: "tenant_test",
      },
    });
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });

    await expect(
      store.readMedia({
        applicationId: "app_test",
        media: {
          bucket: "media-test",
          key: "tenants/tenant_test/whatsapp/audio.ogg",
          mimeType: "audio/ogg",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          sizeBytes: bytes.byteLength,
        },
        tenantId: "tenant_test",
      }),
    ).resolves.toEqual({ bytes, mimeType: "audio/ogg" });
  });
});

describe("S3MediaStore deletion", () => {
  it("deduplicates and deletes only canonical tenant media keys", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });
    const media = {
      bucket: "media-test",
      key: "tenants/tenant_test/telegram/message.jpg",
      mimeType: "image/jpeg",
      sha256: "a".repeat(64),
      sizeBytes: 128,
    };

    await store.deleteMedia({
      applicationId: "app_test",
      media: [media, media],
      tenantId: "tenant_test",
    });

    expect(send).toHaveBeenCalledOnce();
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectsCommand);
    expect((command as DeleteObjectsCommand).input).toEqual({
      Bucket: "media-test",
      Delete: {
        Objects: [{ Key: media.key }],
        Quiet: true,
      },
    });
  });

  it("rejects references outside the configured tenant-media namespace", async () => {
    const send = vi.fn();
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });

    await expect(
      store.deleteMedia({
        applicationId: "app_test",
        media: [
          {
            bucket: "other-bucket",
            key: "tenants/tenant_test/message.jpg",
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            sizeBytes: 128,
          },
        ],
        tenantId: "tenant_test",
      }),
    ).rejects.toThrow("cannot be deleted");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects media keys owned by a different tenant", async () => {
    const send = vi.fn();
    const store = new S3MediaStore({ send } as unknown as S3Client, { bucket: "media-test" });

    await expect(
      store.deleteMedia({
        applicationId: "app_test",
        media: [
          {
            bucket: "media-test",
            key: "tenants/tenant_other/message.jpg",
            mimeType: "image/jpeg",
            sha256: "a".repeat(64),
            sizeBytes: 128,
          },
        ],
        tenantId: "tenant_test",
      }),
    ).rejects.toThrow("cannot be deleted");
    expect(send).not.toHaveBeenCalled();
  });
});
