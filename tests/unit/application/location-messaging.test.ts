/* eslint-disable @typescript-eslint/unbound-method -- Vitest spy assertions intentionally reference mock methods. */
import { describe, expect, it, vi } from "vitest";

import type { TelegramMessageStore } from "../../../src/application/ports/telegram-message-store.js";
import type { WhatsappMessageStore } from "../../../src/application/ports/whatsapp-message-store.js";
import { ProcessTelegramUpdate } from "../../../src/application/telegram/process-telegram-update.js";
import { ProcessWhatsappEvent } from "../../../src/application/whatsapp/process-whatsapp-event.js";
import { conversationMessageSchema } from "../../../src/contracts/api/conversation.contract.js";
import { telegramInboundEnvelopeSchema } from "../../../src/contracts/queues/telegram-inbound.contract.js";
import { whatsappInboundMessageEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-inbound.contract.js";

describe("location messaging", () => {
  it("normalizes an inbound Telegram location", async () => {
    const store: TelegramMessageStore = {
      persistLocationMessage: vi.fn().mockResolvedValue("CREATED"),
      persistTextMessage: vi.fn(),
    };
    const envelope = telegramInboundEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_location",
      eventId: "evt_location",
      eventType: "telegram.update.received",
      integrationId: "int_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      payload: {
        update: {
          message: {
            chat: { id: 123, type: "private" },
            date: 1_786_186_800,
            location: {
              horizontal_accuracy: 15,
              latitude: 4.711,
              longitude: -74.0721,
            },
            message_id: 77,
          },
          update_id: 9001,
        },
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(new ProcessTelegramUpdate(store).execute(envelope)).resolves.toEqual({
      result: "CREATED",
    });
    expect(store.persistLocationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "123",
        latitude: 4.711,
        longitude: -74.0721,
        providerMessageId: "77",
        updateId: "9001",
      }),
    );
    expect(store.persistTextMessage).not.toHaveBeenCalled();
  });

  it("normalizes an inbound WhatsApp location", async () => {
    const store: WhatsappMessageStore = {
      persistLocationMessage: vi.fn().mockResolvedValue("CREATED"),
      persistStatus: vi.fn(),
      persistTextMessage: vi.fn(),
    };
    const envelope = whatsappInboundMessageEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_location",
      eventId: "evt_location",
      eventType: "whatsapp.message.received",
      integrationId: "int_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      payload: {
        contact: {
          profile: { name: "Ada" },
          wa_id: "573001112233",
        },
        kind: "MESSAGE",
        message: {
          from: "573001112233",
          id: "wamid.location",
          location: {
            address: "Bogotá, Colombia",
            latitude: 4.711,
            longitude: -74.0721,
            name: "Ubicación actual",
          },
          timestamp: "1786186800",
          type: "location",
        },
        phoneNumberId: "778899",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(new ProcessWhatsappEvent(store).processMessage(envelope)).resolves.toEqual({
      result: "CREATED",
    });
    expect(store.persistLocationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalType: "WHATSAPP_PHONE",
        latitude: 4.711,
        longitude: -74.0721,
        providerMessageId: "wamid.location",
      }),
    );
    expect(store.persistTextMessage).not.toHaveBeenCalled();
  });

  it("exposes numeric coordinates in the public conversation contract", () => {
    const message = {
      conversationId: "conv_test",
      direction: "INBOUND",
      integrationId: "int_test",
      latitude: 4.711,
      longitude: -74.0721,
      messageId: "msg_test",
      occurredAt: "2026-08-08T12:00:00.000Z",
      provider: "TELEGRAM",
      status: "RECEIVED",
      type: "LOCATION",
    };

    expect(conversationMessageSchema.parse(message)).toEqual(message);
    expect(conversationMessageSchema.safeParse({ ...message, latitude: 91 }).success).toBe(false);
    expect(conversationMessageSchema.safeParse({ ...message, longitude: -181 }).success).toBe(
      false,
    );
  });
});
