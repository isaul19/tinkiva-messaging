import { createHash } from "node:crypto";

import type { S3Client } from "@aws-sdk/client-s3";
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
});
