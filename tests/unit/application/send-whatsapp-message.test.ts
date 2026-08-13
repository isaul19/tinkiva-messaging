import { describe, expect, it, vi } from "vitest";

import { SendWhatsappMessage } from "../../../src/application/whatsapp/send-whatsapp-message.js";
import { whatsappOutboundEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-outbound.contract.js";
import { ApplicationError } from "../../../src/shared/errors/application-error.js";

const envelope = whatsappOutboundEnvelopeSchema.parse({
  applicationId: "app_test",
  correlationId: "corr_test",
  eventId: "evt_test",
  eventType: "whatsapp.message.send",
  integrationId: "int_test",
  occurredAt: "2026-07-25T12:00:00.000Z",
  payload: {
    content: {
      text: { body: "Hola" },
      type: "TEXT",
    },
    conversationId: "conv_test",
    messageId: "msg_test",
    recipientId: "573001112233",
    recipientType: "WHATSAPP_PHONE",
  },
  schemaVersion: 1,
  tenantId: "tenant_test",
});

const createDependencies = () => {
  const store = {
    acquire: vi.fn().mockResolvedValue({
      conversationId: "conv_test",
      content: { text: "Hola", type: "TEXT" as const },
      credentialRef: "pc_test",
      graphApiVersion: "v25.0",
      messageSortKey: "MESSAGE#test",
      phoneNumberId: "778899",
      recipientId: "573001112233",
      status: "CLAIMED" as const,
    }),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    saveProviderMediaId: vi.fn().mockResolvedValue(undefined),
  };
  const credentials = {
    get: vi.fn().mockResolvedValue({
      accessToken: "t".repeat(32),
      appSecret: "s".repeat(32),
      verifyToken: "v".repeat(43),
    }),
  };
  const api = {
    sendText: vi.fn().mockResolvedValue({ providerMessageId: "wamid.outbound" }),
  };

  return { api, credentials, store };
};

describe("SendWhatsappMessage", () => {
  it("decrypts the credential, sends through Graph API, and persists the provider id", async () => {
    const dependencies = createDependencies();
    const useCase = new SendWhatsappMessage(
      dependencies.store,
      dependencies.credentials,
      dependencies.api,
    );

    await expect(useCase.execute(envelope)).resolves.toEqual({ status: "SENT" });
    expect(dependencies.api.sendText).toHaveBeenCalledWith({
      accessToken: "t".repeat(32),
      graphApiVersion: "v25.0",
      phoneNumberId: "778899",
      recipientId: "573001112233",
      text: "Hola",
    });
    expect(dependencies.store.markSent).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: "int_test",
        messageId: "msg_test",
        providerMessageId: "wamid.outbound",
      }),
    );
  });

  it("marks permanent provider rejections as failed", async () => {
    const dependencies = createDependencies();
    dependencies.api.sendText.mockRejectedValue(
      new ApplicationError("PROVIDER_REJECTED_MESSAGE", "Rejected", 422),
    );
    const useCase = new SendWhatsappMessage(
      dependencies.store,
      dependencies.credentials,
      dependencies.api,
    );

    await expect(useCase.execute(envelope)).resolves.toEqual({ status: "FAILED" });
    expect(dependencies.store.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "PROVIDER_REJECTED_MESSAGE",
      }),
    );
    expect(dependencies.store.release).not.toHaveBeenCalled();
  });

  it("uploads stored audio once and sends it through WhatsApp", async () => {
    const dependencies = createDependencies();
    dependencies.store.acquire.mockResolvedValue({
      conversationId: "conv_test",
      content: {
        media: {
          mimeType: "audio/ogg",
          sha256: "c".repeat(64),
          sizeBytes: 2_048,
          storageKey: "tenants/tenant_test/outbound/audio.ogg",
        },
        type: "AUDIO",
        voice: false,
      },
      credentialRef: "pc_test",
      graphApiVersion: "v25.0",
      messageSortKey: "MESSAGE#test",
      phoneNumberId: "778899",
      recipientId: "573001112233",
      status: "CLAIMED" as const,
    });
    const audioApi = {
      ...dependencies.api,
      sendAudio: vi.fn().mockResolvedValue({ providerMessageId: "wamid.audio" }),
      uploadAudio: vi.fn().mockResolvedValue({ providerMediaId: "provider-audio" }),
    };
    const media = {
      readImage: vi.fn(),
      readAudio: vi.fn().mockResolvedValue({
        bytes: Buffer.from("OggS"),
        mimeType: "audio/ogg",
      }),
    };
    const useCase = new SendWhatsappMessage(
      dependencies.store,
      dependencies.credentials,
      audioApi,
      media,
    );

    await expect(useCase.execute(envelope)).resolves.toEqual({ status: "SENT" });
    expect(audioApi.uploadAudio).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "audio/ogg", phoneNumberId: "778899" }),
    );
    expect(dependencies.store.saveProviderMediaId).toHaveBeenCalledWith(
      expect.objectContaining({ providerMediaId: "provider-audio" }),
    );
    expect(audioApi.sendAudio).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: "provider-audio", recipientId: "573001112233" }),
    );
  });

  it("releases the lease and retries transient provider failures", async () => {
    const dependencies = createDependencies();
    const error = new ApplicationError("PROVIDER_UNAVAILABLE", "Unavailable", 503, true);
    dependencies.api.sendText.mockRejectedValue(error);
    const useCase = new SendWhatsappMessage(
      dependencies.store,
      dependencies.credentials,
      dependencies.api,
    );

    await expect(useCase.execute(envelope)).rejects.toBe(error);
    expect(dependencies.store.release).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_test",
        messageSortKey: "MESSAGE#test",
      }),
    );
    expect(dependencies.store.markFailed).not.toHaveBeenCalled();
  });
});
