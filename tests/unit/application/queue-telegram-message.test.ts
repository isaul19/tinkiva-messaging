/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method -- Vitest spy assertions intentionally reference mock methods. */
import { describe, expect, it, vi } from "vitest";

import type { OutgoingMessageStore } from "../../../src/application/ports/outgoing-message-store.js";
import type { TelegramOutboundPublisher } from "../../../src/application/ports/telegram-outbound-publisher.js";
import { QueueTelegramMessage } from "../../../src/application/messages/queue-telegram-message.js";

const request = {
  content: {
    text: {
      body: "Hola desde Tinkiva",
    },
    type: "TEXT" as const,
  },
  integrationId: "int_telegram",
  recipient: {
    type: "TELEGRAM_CHAT_ID" as const,
    value: "-100123",
  },
  tenantId: "tenant_demo",
};

const createDependencies = (status: "CREATED" | "ENQUEUED") => {
  const store: OutgoingMessageStore = {
    markEnqueued: vi.fn().mockResolvedValue(undefined),
    reserveTelegramMessage: vi.fn().mockResolvedValue({
      messageId: "msg_reserved",
      status,
    }),
    resolveTelegramDestination: vi.fn().mockResolvedValue({
      chatId: "-100123",
      conversationId: "conv_telegram",
      createDestinationRecords: true,
    }),
  };
  const publisher: TelegramOutboundPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return { publisher, store };
};

describe("QueueTelegramMessage", () => {
  it("reserves, publishes, and marks a new message as enqueued", async () => {
    const { publisher, store } = createDependencies("CREATED");
    const service = new QueueTelegramMessage(store, publisher);

    await expect(
      service.execute({
        applicationId: "app_demo",
        correlationId: "cor_demo",
        idempotencyKey: "order:123",
        request,
      }),
    ).resolves.toEqual({
      idempotencyKey: "order:123",
      messageId: "msg_reserved",
      status: "QUEUED",
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app_demo",
        eventType: "telegram.message.send",
        payload: expect.objectContaining({
          chatId: "-100123",
          messageId: "msg_reserved",
        }),
      }),
    );
    expect(store.markEnqueued).toHaveBeenCalledOnce();
  });

  it("returns the original message without publishing an already enqueued command", async () => {
    const { publisher, store } = createDependencies("ENQUEUED");
    const service = new QueueTelegramMessage(store, publisher);

    await service.execute({
      applicationId: "app_demo",
      correlationId: "cor_demo",
      idempotencyKey: "order:123",
      request,
    });

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(store.markEnqueued).not.toHaveBeenCalled();
  });

  it("imports and queues an outbound audio with its optional caption", async () => {
    const { publisher, store } = createDependencies("CREATED");
    const media = {
      importAudio: vi.fn().mockResolvedValue({
        mimeType: "audio/mpeg",
        sha256: "a".repeat(64),
        sizeBytes: 1_024,
        storageKey: "tenants/tenant_demo/outbound/audio.mp3",
      }),
      importImage: vi.fn(),
    };
    const service = new QueueTelegramMessage(store, publisher, media);

    await service.execute({
      applicationId: "app_demo",
      correlationId: "cor_demo",
      idempotencyKey: "audio:123",
      request: {
        content: {
          media: { text: "Escucha esto", url: "https://media.example/audio.mp3" },
          type: "AUDIO",
        },
        integrationId: "int_telegram",
        recipient: { type: "TELEGRAM_CHAT_ID", value: "123" },
        tenantId: "tenant_demo",
      },
    });

    expect(media.importAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptedMimeTypes: ["audio/mpeg", "audio/mp4"],
        maxSizeBytes: 16 * 1024 * 1024,
        sourceUrl: "https://media.example/audio.mp3",
      }),
    );
    expect(store.reserveTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          caption: "Escucha esto",
          type: "AUDIO",
          voice: false,
        }),
      }),
    );
  });

  it("rejects media until the Telegram media worker is enabled", async () => {
    const { publisher, store } = createDependencies("CREATED");
    const service = new QueueTelegramMessage(store, publisher);

    await expect(
      service.execute({
        applicationId: "app_demo",
        correlationId: "cor_demo",
        idempotencyKey: "media:123",
        request: {
          content: {
            media: {
              mediaId: "media_123",
            },
            type: "IMAGE",
          },
          integrationId: "int_telegram",
          recipient: {
            type: "TELEGRAM_CHAT_ID",
            value: "123",
          },
          tenantId: "tenant_demo",
        },
      }),
    ).rejects.toMatchObject({
      code: "MESSAGE_NOT_SENDABLE",
      statusCode: 422,
    });
    expect(store.resolveTelegramDestination).not.toHaveBeenCalled();
  });
});
