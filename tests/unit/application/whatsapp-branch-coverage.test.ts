import { describe, expect, it, vi } from "vitest";

import { ProcessWhatsappEvent } from "../../../src/application/whatsapp/process-whatsapp-event.js";
import { RegisterWhatsappIntegration } from "../../../src/application/whatsapp/register-whatsapp-integration.js";
import { SendWhatsappMessage } from "../../../src/application/whatsapp/send-whatsapp-message.js";
import { whatsappInboundMessageEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-inbound.contract.js";
import { whatsappOutboundEnvelopeSchema } from "../../../src/contracts/queues/whatsapp-outbound.contract.js";

describe("WhatsApp optional and terminal branches", () => {
  it("uses the sender phone as canonical identity when Meta provides no contact", async () => {
    const store = {
      persistStatus: vi.fn().mockResolvedValue("UPDATED" as const),
      persistTextMessage: vi.fn().mockResolvedValue("CREATED" as const),
    };
    const useCase = new ProcessWhatsappEvent(store);
    const envelope = whatsappInboundMessageEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_test",
      eventId: "evt_phone",
      eventType: "whatsapp.message.received",
      integrationId: "int_test",
      occurredAt: "2026-07-25T12:00:00.000Z",
      payload: {
        kind: "MESSAGE",
        message: {
          from: "+573001112233",
          id: "wamid.phone",
          text: { body: "Hola" },
          timestamp: "1760000000",
          type: "text",
        },
        phoneNumberId: "778899",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await useCase.processMessage(envelope);

    expect(store.persistTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalType: "WHATSAPP_PHONE",
        canonicalValue: "573001112233",
        phoneE164: "+573001112233",
      }),
    );
  });

  it("does not decrypt or send a message already in a terminal state", async () => {
    const store = {
      acquire: vi.fn().mockResolvedValue({ status: "TERMINAL" as const }),
      markFailed: vi.fn(),
      markSent: vi.fn(),
      release: vi.fn(),
      saveProviderMediaId: vi.fn(),
    };
    const credentials = { get: vi.fn() };
    const api = { sendText: vi.fn() };
    const useCase = new SendWhatsappMessage(store, credentials, api);
    const envelope = whatsappOutboundEnvelopeSchema.parse({
      applicationId: "app_test",
      correlationId: "corr_test",
      eventId: "evt_terminal",
      eventType: "whatsapp.message.send",
      integrationId: "int_test",
      occurredAt: "2026-07-25T12:00:00.000Z",
      payload: {
        content: { text: { body: "Hola" }, type: "TEXT" },
        conversationId: "conv_test",
        messageId: "msg_test",
        recipientId: "573001112233",
        recipientType: "WHATSAPP_PHONE",
      },
      schemaVersion: 1,
      tenantId: "tenant_test",
    });

    await expect(useCase.execute(envelope)).resolves.toEqual({ status: "TERMINAL" });
    expect(credentials.get).not.toHaveBeenCalled();
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("deletes the encrypted credential if pending integration records cannot be created", async () => {
    const managementApi = {
      getPhoneNumbers: vi.fn().mockResolvedValue([{ id: "778899" }]),
      subscribeWaba: vi.fn(),
    };
    const credentials = {
      create: vi.fn().mockResolvedValue("pc_test"),
      deleteImmediately: vi.fn().mockResolvedValue(undefined),
    };
    const store = {
      createPending: vi.fn().mockRejectedValue(new Error("duplicate WABA")),
      deletePending: vi.fn(),
      setStatus: vi.fn(),
    };
    const useCase = new RegisterWhatsappIntegration(managementApi, credentials, store, {
      graphApiVersion: "v25.0",
      webhookBaseUrl: "https://messaging.example",
    });

    await expect(
      useCase.execute({
        applicationId: "app_test",
        request: {
          accessToken: "t".repeat(32),
          appSecret: "s".repeat(32),
          displayName: "WhatsApp",
          inboundMedia: {
            audioAlternativeText: false,
            imageAlternativeText: false,
          },
          metaAppId: "445566",
          phoneNumberId: "778899",
          wabaId: "991122",
        },
        tenantId: "tenant_test",
      }),
    ).rejects.toThrow("duplicate WABA");
    expect(credentials.deleteImmediately).toHaveBeenCalledWith("pc_test");
    expect(managementApi.subscribeWaba).not.toHaveBeenCalled();
  });
});
