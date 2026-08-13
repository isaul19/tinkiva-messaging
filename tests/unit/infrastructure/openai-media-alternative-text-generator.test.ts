import { describe, expect, it, vi } from "vitest";

import { OpenAIMediaAlternativeTextGenerator } from "../../../src/infrastructure/openai/openai-media-alternative-text-generator.js";
import { OpenAIPerIntegrationMediaAlternativeTextGenerator } from "../../../src/infrastructure/openai/openai-per-integration-media-alternative-text-generator.js";

const image = {
  bucket: "media-test",
  key: "tenants/tenant_test/image.jpg",
  mimeType: "image/jpeg",
  sha256: "a".repeat(64),
  sizeBytes: 3,
};

const audio = {
  ...image,
  key: "tenants/tenant_test/voice.ogg",
  mimeType: "audio/ogg",
};

const config = {
  apiKey: "sk-test-key-long-enough-for-schema",
  audioModel: "gpt-4o-mini-transcribe",
  imageModel: "gpt-5.6-luna",
};

describe("OpenAIMediaAlternativeTextGenerator", () => {
  it("describes images with Responses without server-side storage", async () => {
    const createResponse = vi.fn().mockResolvedValue({ output_text: "  Una factura visible.  " });
    const readMedia = vi
      .fn()
      .mockResolvedValue({ bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/jpeg" });
    const generator = new OpenAIMediaAlternativeTextGenerator(
      { readMedia },
      { normalize: vi.fn() },
      config,
      {
        audio: { transcriptions: { create: vi.fn() } },
        responses: { create: createResponse },
      } as never,
    );

    await expect(
      generator.generate({
        applicationId: "app_test",
        caption: "Revisa esto",
        integrationId: "int_test",
        media: image,
        tenantId: "tenant_test",
      }),
    ).resolves.toBe("Una factura visible.");
    expect(readMedia).toHaveBeenCalledWith({
      applicationId: "app_test",
      media: image,
      tenantId: "tenant_test",
    });
    expect(createResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-luna",
        reasoning: { effort: "none" },
        store: false,
      }),
    );
  });

  it("normalizes and transcribes audio through the account client", async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: " Hola desde el audio " });
    const normalize = vi.fn().mockResolvedValue({
      bytes: Uint8Array.from([1, 2, 3]),
      extension: "mp3",
      mimeType: "audio/mpeg",
    });
    const generator = new OpenAIMediaAlternativeTextGenerator(
      {
        readMedia: vi
          .fn()
          .mockResolvedValue({ bytes: Uint8Array.from([1, 2, 3]), mimeType: "audio/ogg" }),
      },
      { normalize },
      config,
      {
        audio: { transcriptions: { create: transcribe } },
        responses: { create: vi.fn() },
      } as never,
    );

    await expect(
      generator.generate({
        applicationId: "app_test",
        integrationId: "int_test",
        media: audio,
        tenantId: "tenant_test",
      }),
    ).resolves.toBe("Hola desde el audio");
    expect(normalize).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "audio/ogg" }));
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini-transcribe", response_format: "json" }),
    );
  });

  it("rejects empty model output", async () => {
    const generator = new OpenAIMediaAlternativeTextGenerator(
      {
        readMedia: vi
          .fn()
          .mockResolvedValue({ bytes: Uint8Array.from([1]), mimeType: "image/jpeg" }),
      },
      { normalize: vi.fn() },
      config,
      {
        audio: { transcriptions: { create: vi.fn() } },
        responses: { create: vi.fn().mockResolvedValue({ output_text: " " }) },
      } as never,
    );

    await expect(
      generator.generate({
        applicationId: "app_test",
        integrationId: "int_test",
        media: image,
        tenantId: "tenant_test",
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("resolves the integration credential before reading protected media", async () => {
    const unavailable = new Error("credential unavailable");
    const get = vi.fn().mockRejectedValue(unavailable);
    const readMedia = vi.fn();
    const generator = new OpenAIPerIntegrationMediaAlternativeTextGenerator(
      { readMedia },
      { normalize: vi.fn() },
      {
        batchStatus: vi.fn(),
        get,
        status: vi.fn(),
      },
      config,
    );

    await expect(
      generator.generate({
        applicationId: "app_test",
        integrationId: "int_test",
        media: image,
        tenantId: "tenant_test",
      }),
    ).rejects.toBe(unavailable);
    expect(get).toHaveBeenCalledWith({
      applicationId: "app_test",
      integrationId: "int_test",
      tenantId: "tenant_test",
    });
    expect(readMedia).not.toHaveBeenCalled();
  });
});
