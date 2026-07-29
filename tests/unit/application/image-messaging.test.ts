/* eslint-disable @typescript-eslint/unbound-method -- Vitest spy assertions intentionally reference mock methods. */
import { describe, expect, it, vi } from "vitest";

import type {
  InboundImageImporter,
  MediaBinaryReader,
  MediaUrlSigner,
} from "../../../src/application/ports/media.js";
import type { TelegramMessageStore } from "../../../src/application/ports/telegram-message-store.js";
import type { WhatsappMessageStore } from "../../../src/application/ports/whatsapp-message-store.js";
import { QueueTelegramMessage } from "../../../src/application/messages/queue-telegram-message.js";
import { QueueWhatsappMessage } from "../../../src/application/messages/queue-whatsapp-message.js";
import { ProcessTelegramUpdate } from "../../../src/application/telegram/process-telegram-update.js";
import { SendTelegramMessage } from "../../../src/application/telegram/send-telegram-message.js";
import { ProcessWhatsappEvent } from "../../../src/application/whatsapp/process-whatsapp-event.js";
import { SendWhatsappMessage } from "../../../src/application/whatsapp/send-whatsapp-message.js";
import { sendMessageRequestSchema } from "../../../src/contracts/api/message.contract.js";
import { telegramInboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-inbound.contract.js";
import { telegramOutboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-outbound.contract.js";
import { whatsappInboundMessageEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-inbound.contract.js";
import { whatsappOutboundEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-outbound.contract.js";

const mediaReference = {
  bucket: "media-test",
  key: "tenants/tenant_test/telegram/2026/07/29/msg/image.jpg",
  mimeType: "image/jpeg",
  sha256: "a".repeat(64),
  sizeBytes: 123,
};

const createImporter = (): InboundImageImporter => ({
  importTelegramImage: vi.fn().mockResolvedValue(mediaReference),
  importWhatsappImage: vi.fn().mockResolvedValue(mediaReference),
});

describe("image messaging", () => {
  it("accepts the frontend URL plus text contract without ambiguity", () => {
    const request = {
      content: {
        media: {
          text: "POLO PRUEBA",
          url: "https://cdn.example/polo.jpg",
        },
        type: "IMAGE",
      },
      conversationId: "conv_test",
      integrationId: "int_test",
      tenantId: "tenant_test",
    };

    expect(sendMessageRequestSchema.parse(request)).toMatchObject(request);
    expect(() =>
      sendMessageRequestSchema.parse({
        ...request,
        content: {
          ...request.content,
          media: { ...request.content.media, caption: "Duplicado" },
        },
      }),
    ).toThrow();
  });

  it("imports and queues a Telegram image URL", async () => {
    const store = {
      markEnqueued: vi.fn(),
      reserveTelegramMessage: vi.fn().mockResolvedValue({
        messageId: "msg_out",
        status: "CREATED" as const,
      }),
      resolveTelegramDestination: vi.fn().mockResolvedValue({
        chatId: "123",
        conversationId: "conv_test",
        createDestinationRecords: false,
      }),
    };
    const publisher = { publish: vi.fn() };
    const outboundMedia = { importImage: vi.fn().mockResolvedValue(mediaReference) };
    const service = new QueueTelegramMessage(store, publisher, outboundMedia);

    await expect(
      service.execute({
        applicationId: "app_test",
        correlationId: "corr_test",
        idempotencyKey: "image-1",
        request: {
          content: {
            media: {
              text: "Oferta",
              url: "https://cdn.example/image.jpg",
            },
            type: "IMAGE",
          },
          conversationId: "conv_test",
          integrationId: "int_test",
          tenantId: "tenant_test",
        },
      }),
    ).resolves.toEqual({
      idempotencyKey: "image-1",
      messageId: "msg_out",
      status: "QUEUED",
    });
    expect(outboundMedia.importImage).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: "https://cdn.example/image.jpg" }),
    );
    expect(store.reserveTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          caption: "Oferta",
          media: mediaReference,
          type: "IMAGE",
        },
      }),
    );
    await service.execute({
      applicationId: "app_test",
      correlationId: "corr_test",
      idempotencyKey: "image-1b",
      request: {
        content: { media: { mediaId: mediaReference.key }, type: "IMAGE" },
        conversationId: "conv_test",
        integrationId: "int_test",
        tenantId: "tenant_test",
      },
    });
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(store.markEnqueued).toHaveBeenCalledTimes(2);
  });

  it("imports and queues a stored WhatsApp image", async () => {
    const store = {
      markEnqueued: vi.fn(),
      reserveWhatsappMessage: vi.fn().mockResolvedValue({
        messageId: "msg_out",
        status: "CREATED" as const,
      }),
      resolveWhatsappDestination: vi.fn().mockResolvedValue({
        conversationId: "conv_test",
        createDestinationRecords: false,
        recipientId: "573001112233",
        recipientType: "WHATSAPP_PHONE" as const,
      }),
    };
    const publisher = { publish: vi.fn() };
    const outboundMedia = { importImage: vi.fn().mockResolvedValue(mediaReference) };
    const service = new QueueWhatsappMessage(store, publisher, outboundMedia);

    await service.execute({
      applicationId: "app_test",
      correlationId: "corr_test",
      idempotencyKey: "image-2",
      request: {
        content: { media: { mediaId: mediaReference.key }, type: "IMAGE" },
        conversationId: "conv_test",
        integrationId: "int_test",
        tenantId: "tenant_test",
      },
    });

    expect(outboundMedia.importImage).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: mediaReference.key }),
    );
    expect(store.reserveWhatsappMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: { media: mediaReference, type: "IMAGE" } }),
    );
    await service.execute({
      applicationId: "app_test",
      correlationId: "corr_test",
      idempotencyKey: "image-2b",
      request: {
        content: {
          media: {
            text: "Oferta",
            url: "https://cdn.example/image.jpg",
          },
          type: "IMAGE",
        },
        conversationId: "conv_test",
        integrationId: "int_test",
        tenantId: "tenant_test",
      },
    });
    expect(store.reserveWhatsappMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: {
          caption: "Oferta",
          media: mediaReference,
          type: "IMAGE",
        },
      }),
    );
    expect(outboundMedia.importImage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        acceptedMimeTypes: ["image/jpeg", "image/png"],
        maxSizeBytes: 5 * 1024 * 1024,
        sourceUrl: "https://cdn.example/image.jpg",
      }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });

  it("imports and persists the largest Telegram photo", async () => {
    const importer = createImporter();
    const store: TelegramMessageStore = {
      persistImageMessage: vi.fn().mockResolvedValue("CREATED"),
      persistTextMessage: vi.fn(),
    };
    const envelope = telegramInboundEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_test",
      eventId: "evt_test",
      eventType: "telegram.update.received",
      integrationId: "int_test",
      occurredAt: "2026-07-29T00:00:00.000Z",
      payload: {
        update: {
          message: {
            caption: "Promoción",
            chat: { id: 123, type: "private" },
            date: 1_769_000_000,
            message_id: 7,
            photo: [
              { file_id: "small", file_unique_id: "u1", height: 100, width: 100 },
              { file_id: "large", file_unique_id: "u2", height: 1_000, width: 1_000 },
            ],
          },
          update_id: 99,
        },
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(new ProcessTelegramUpdate(store, importer).execute(envelope)).resolves.toEqual({
      result: "CREATED",
    });
    expect(importer.importTelegramImage).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "large" }),
    );
    expect(store.persistImageMessage).toHaveBeenCalledWith(
      expect.objectContaining({ caption: "Promoción", media: mediaReference }),
    );
  });

  it("imports and persists a WhatsApp image reference", async () => {
    const importer = createImporter();
    const store: WhatsappMessageStore = {
      persistImageMessage: vi.fn().mockResolvedValue("CREATED"),
      persistStatus: vi.fn(),
      persistTextMessage: vi.fn(),
    };
    const envelope = whatsappInboundMessageEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_test",
      eventId: "evt_test",
      eventType: "whatsapp.message.received",
      integrationId: "int_test",
      occurredAt: "2026-07-29T00:00:00.000Z",
      payload: {
        kind: "MESSAGE",
        message: {
          from: "573001112233",
          id: "wamid.image",
          image: {
            caption: "Promoción",
            id: "media-from-meta",
            mime_type: "image/jpeg",
            sha256: "provider-checksum",
          },
          timestamp: "1769000000",
          type: "image",
        },
        phoneNumberId: "778899",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(
      new ProcessWhatsappEvent(store, importer).processMessage(envelope),
    ).resolves.toEqual({ result: "CREATED" });
    expect(importer.importWhatsappImage).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: "media-from-meta" }),
    );
    expect(store.persistImageMessage).toHaveBeenCalledWith(
      expect.objectContaining({ caption: "Promoción", media: mediaReference }),
    );
  });

  it("sends a Telegram photo with the unified text caption", async () => {
    const store = {
      acquire: vi.fn().mockResolvedValue({
        chatId: "123",
        content: { caption: "Promoción", media: mediaReference, type: "IMAGE" as const },
        conversationId: "conv_test",
        credentialRef: "pc_test",
        messageSortKey: "MESSAGE#test",
        status: "CLAIMED" as const,
      }),
      markFailed: vi.fn(),
      markSent: vi.fn(),
      release: vi.fn(),
    };
    const api = {
      sendImage: vi.fn().mockResolvedValue({ providerMessageId: "77" }),
      sendText: vi.fn(),
    };
    const signer: MediaUrlSigner = {
      temporaryDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/image.jpg"),
    };
    const service = new SendTelegramMessage(
      store,
      { get: vi.fn().mockResolvedValue({ botToken: "token", webhookSecretToken: "secret" }) },
      api,
      signer,
    );
    const envelope = telegramOutboundEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_test",
      eventId: "evt_test",
      eventType: "telegram.message.send",
      integrationId: "int_test",
      occurredAt: "2026-07-29T00:00:00.000Z",
      payload: {
        chatId: "123",
        content: { media: { mediaId: mediaReference.key, text: "Promoción" }, type: "IMAGE" },
        conversationId: "conv_test",
        messageId: "msg_test",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(service.execute(envelope)).resolves.toEqual({ status: "SENT" });
    expect(api.sendImage).toHaveBeenCalledWith({
      botToken: "token",
      caption: "Promoción",
      chatId: "123",
      imageUrl: "https://signed.example/image.jpg",
    });
  });

  it("sends a WhatsApp image with the unified text caption", async () => {
    const store = {
      acquire: vi.fn().mockResolvedValue({
        content: { caption: "Promoción", media: mediaReference, type: "IMAGE" as const },
        conversationId: "conv_test",
        credentialRef: "pc_test",
        graphApiVersion: "v25.0",
        messageSortKey: "MESSAGE#test",
        phoneNumberId: "778899",
        recipientId: "573001112233",
        status: "CLAIMED" as const,
      }),
      markFailed: vi.fn(),
      markSent: vi.fn(),
      release: vi.fn(),
      saveProviderMediaId: vi.fn(),
    };
    const api = {
      sendImage: vi.fn().mockResolvedValue({ providerMessageId: "wamid.image" }),
      sendText: vi.fn().mockResolvedValue({ providerMessageId: "wamid.text" }),
      uploadImage: vi.fn().mockResolvedValue({ providerMediaId: "meta-media-1" }),
    };
    const media: MediaBinaryReader = {
      readImage: vi.fn().mockResolvedValue({
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: "image/jpeg",
      }),
    };
    const service = new SendWhatsappMessage(
      store,
      {
        get: vi.fn().mockResolvedValue({
          accessToken: "t".repeat(32),
          appSecret: "s".repeat(32),
          verifyToken: "v".repeat(43),
        }),
      },
      api,
      media,
    );
    const envelope = whatsappOutboundEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_test",
      eventId: "evt_test",
      eventType: "whatsapp.message.send",
      integrationId: "int_test",
      occurredAt: "2026-07-29T00:00:00.000Z",
      payload: {
        content: { media: { mediaId: mediaReference.key, text: "Promoción" }, type: "IMAGE" },
        conversationId: "conv_test",
        messageId: "msg_test",
        recipientId: "573001112233",
        recipientType: "WHATSAPP_PHONE",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(service.execute(envelope)).resolves.toEqual({ status: "SENT" });
    expect(api.sendText).not.toHaveBeenCalled();
    expect(api.uploadImage).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: "image/jpeg",
        phoneNumberId: "778899",
      }),
    );
    expect(store.saveProviderMediaId).toHaveBeenCalledWith({
      conversationId: "conv_test",
      messageSortKey: "MESSAGE#test",
      providerMediaId: "meta-media-1",
    });
    expect(api.sendImage).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: "Promoción",
        mediaId: "meta-media-1",
      }),
    );
  });

  it("reuses a persisted WhatsApp Media ID after a retry", async () => {
    const store = {
      acquire: vi.fn().mockResolvedValue({
        content: { media: mediaReference, type: "IMAGE" as const },
        conversationId: "conv_test",
        credentialRef: "pc_test",
        graphApiVersion: "v25.0",
        messageSortKey: "MESSAGE#test",
        phoneNumberId: "778899",
        providerMediaId: "meta-media-existing",
        recipientId: "573001112233",
        status: "CLAIMED" as const,
      }),
      markFailed: vi.fn(),
      markSent: vi.fn(),
      release: vi.fn(),
      saveProviderMediaId: vi.fn(),
    };
    const api = {
      sendImage: vi.fn().mockResolvedValue({ providerMessageId: "wamid.image" }),
      sendText: vi.fn(),
      uploadImage: vi.fn(),
    };
    const media: MediaBinaryReader = { readImage: vi.fn() };
    const service = new SendWhatsappMessage(
      store,
      {
        get: vi.fn().mockResolvedValue({
          accessToken: "t".repeat(32),
          appSecret: "s".repeat(32),
          verifyToken: "v".repeat(43),
        }),
      },
      api,
      media,
    );
    await expect(
      service.execute(
        whatsappOutboundEnvelopeSchema.parse({
          applicationId: "app_test",
          correlationId: "corr_test",
          eventId: "evt_test",
          eventType: "whatsapp.message.send",
          integrationId: "int_test",
          occurredAt: "2026-07-29T00:00:00.000Z",
          payload: {
            content: { media: { mediaId: mediaReference.key }, type: "IMAGE" },
            conversationId: "conv_test",
            messageId: "msg_test",
            recipientId: "573001112233",
            recipientType: "WHATSAPP_PHONE",
          },
          schemaVersion: 1,
          tenantId: "tenant_test",
        }),
      ),
    ).resolves.toEqual({ status: "SENT" });

    expect(media.readImage).not.toHaveBeenCalled();
    expect(api.uploadImage).not.toHaveBeenCalled();
    expect(store.saveProviderMediaId).not.toHaveBeenCalled();
    expect(api.sendImage).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId: "meta-media-existing" }),
    );
  });
});
