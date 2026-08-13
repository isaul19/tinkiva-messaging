/* eslint-disable @typescript-eslint/unbound-method -- Vitest spy assertions intentionally reference mock methods. */
import { describe, expect, it, vi } from "vitest";

import type { InboundImageImporter } from "../../../src/application/ports/media.js";
import type { TelegramMessageStore } from "../../../src/application/ports/telegram-message-store.js";
import type { WhatsappMessageStore } from "../../../src/application/ports/whatsapp-message-store.js";
import { ProcessTelegramUpdate } from "../../../src/application/telegram/process-telegram-update.js";
import { ProcessWhatsappEvent } from "../../../src/application/whatsapp/process-whatsapp-event.js";
import { conversationMessageSchema } from "../../../src/contracts/api/conversation.contract.js";
import { telegramInboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-inbound.contract.js";
import { whatsappInboundMessageEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-inbound.contract.js";

const mediaReference = {
  bucket: "media-test",
  key: "tenants/tenant_test/telegram/2026/08/08/msg_test/audio.ogg",
  mimeType: "audio/ogg",
  sha256: "a".repeat(64),
  sizeBytes: 1_024,
};

const importer = (): InboundImageImporter => ({
  importTelegramAudio: vi.fn().mockResolvedValue(mediaReference),
  importTelegramImage: vi.fn(),
  importWhatsappAudio: vi.fn().mockResolvedValue(mediaReference),
  importWhatsappImage: vi.fn(),
});

describe("audio messaging", () => {
  it("normalizes a Telegram voice note", async () => {
    const media = importer();
    const store: TelegramMessageStore = {
      persistAudioMessage: vi.fn().mockResolvedValue("CREATED"),
      persistTextMessage: vi.fn(),
    };
    const envelope = telegramInboundEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_audio",
      eventId: "evt_audio",
      eventType: "telegram.update.received",
      integrationId: "int_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      payload: {
        update: {
          message: {
            chat: { id: 123, type: "private" },
            date: 1_786_186_800,
            message_id: 78,
            voice: {
              duration: 9,
              file_id: "voice-file",
              file_size: 1_024,
              file_unique_id: "voice-unique",
              mime_type: "audio/ogg",
            },
          },
          update_id: 9002,
        },
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(new ProcessTelegramUpdate(store, media).execute(envelope)).resolves.toEqual({
      result: "CREATED",
    });
    expect(media.importTelegramAudio).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "voice-file", mimeType: "audio/ogg" }),
    );
    expect(store.persistAudioMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 9,
        media: mediaReference,
        providerMessageId: "78",
        voice: true,
      }),
    );
  });

  it("normalizes a WhatsApp voice message", async () => {
    const media = importer();
    const store: WhatsappMessageStore = {
      persistAudioMessage: vi.fn().mockResolvedValue("CREATED"),
      persistStatus: vi.fn(),
      persistTextMessage: vi.fn(),
    };
    const envelope = whatsappInboundMessageEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_audio",
      eventId: "evt_audio",
      eventType: "whatsapp.message.received",
      integrationId: "int_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      payload: {
        kind: "MESSAGE",
        message: {
          audio: {
            id: "whatsapp-audio",
            mime_type: "audio/ogg; codecs=opus",
            sha256: "provider-checksum",
            voice: true,
          },
          from: "573001112233",
          id: "wamid.audio",
          timestamp: "1786186800",
          type: "audio",
        },
        phoneNumberId: "778899",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(new ProcessWhatsappEvent(store, media).processMessage(envelope)).resolves.toEqual({
      result: "CREATED",
    });
    expect(media.importWhatsappAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaId: "whatsapp-audio",
        mimeType: "audio/ogg; codecs=opus",
        providerSha256: "provider-checksum",
      }),
    );
    expect(store.persistAudioMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        media: mediaReference,
        providerMessageId: "wamid.audio",
        voice: true,
      }),
    );
  });

  it("exposes playable audio in the public conversation contract", () => {
    const message = {
      caption: "Nota de voz",
      conversationId: "conv_test",
      direction: "INBOUND",
      durationSeconds: 9,
      integrationId: "int_test",
      media: {
        mediaId: mediaReference.key,
        mimeType: "audio/ogg",
        sha256: mediaReference.sha256,
        sizeBytes: mediaReference.sizeBytes,
        url: "https://signed.example/audio.ogg",
      },
      messageId: "msg_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      provider: "TELEGRAM",
      status: "RECEIVED",
      type: "AUDIO",
      voice: true,
    };

    expect(conversationMessageSchema.parse(message)).toEqual(message);
    expect(
      conversationMessageSchema.safeParse({
        ...message,
        media: { ...message.media, mimeType: "video/mp4" },
      }).success,
    ).toBe(false);
  });

  it("exposes generated alternative text only as inbound media metadata", () => {
    const message = {
      conversationId: "conv_test",
      direction: "INBOUND",
      integrationId: "int_test",
      media: {
        mediaId: mediaReference.key,
        mimeType: "audio/ogg",
        sha256: mediaReference.sha256,
        sizeBytes: mediaReference.sizeBytes,
        url: "https://signed.example/audio.ogg",
      },
      messageId: "msg_test",
      metadata: { alternativeText: "La persona confirma que llegará a las tres." },
      occurredAt: "2026-08-08T12:00:00.000Z",
      provider: "TELEGRAM",
      status: "RECEIVED",
      type: "AUDIO",
      voice: true,
    };

    expect(conversationMessageSchema.parse(message)).toEqual(message);
    expect(
      conversationMessageSchema.safeParse({
        ...message,
        metadata: { alternativeText: "" },
      }).success,
    ).toBe(false);
    expect(
      conversationMessageSchema.safeParse({
        ...message,
        direction: "OUTBOUND",
      }).success,
    ).toBe(false);
  });
});
