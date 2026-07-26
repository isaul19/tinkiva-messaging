import { describe, expect, it, vi } from "vitest";

import { ProcessWhatsappEvent } from "../../../src/application/whatsapp/process-whatsapp-event.js";
import {
  whatsappInboundMessageEnvelopeSchema,
  whatsappInboundStatusEnvelopeSchema,
} from "../../../src/contracts/queues/whatsapp-inbound.contract.js";

const envelopeBase = {
  applicationId: "app_test",
  correlationId: "corr_test",
  eventId: "evt_test",
  integrationId: "int_test",
  occurredAt: "2026-07-25T12:00:00.000Z",
  schemaVersion: 1 as const,
  tenantId: "tenant_test",
};

describe("ProcessWhatsappEvent", () => {
  it("normalizes BSUID as the canonical identity while retaining the phone alias", async () => {
    const store = {
      persistStatus: vi.fn().mockResolvedValue("UPDATED" as const),
      persistTextMessage: vi.fn().mockResolvedValue("CREATED" as const),
    };
    const useCase = new ProcessWhatsappEvent(store);
    const envelope = whatsappInboundMessageEnvelopeSchema.parse({
      ...envelopeBase,
      eventType: "whatsapp.message.received",
      payload: {
        contact: {
          profile: { name: "Saul" },
          user_id: "bsuid_123",
          username: "saul",
          wa_id: "573001112233",
        },
        kind: "MESSAGE",
        message: {
          from: "573001112233",
          id: "wamid.inbound",
          text: { body: "Hola desde WhatsApp" },
          timestamp: "1760000000",
          type: "text",
        },
        phoneNumberId: "778899",
      },
    });

    await expect(useCase.processMessage(envelope)).resolves.toEqual({ result: "CREATED" });
    expect(store.persistTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bsuid: "bsuid_123",
        canonicalType: "WHATSAPP_BSUID",
        canonicalValue: "bsuid_123",
        displayName: "Saul",
        phoneE164: "+573001112233",
        providerMessageId: "wamid.inbound",
        text: "Hola desde WhatsApp",
        username: "saul",
      }),
    );
  });

  it("normalizes status updates and failure codes", async () => {
    const store = {
      persistStatus: vi.fn().mockResolvedValue("UPDATED" as const),
      persistTextMessage: vi.fn().mockResolvedValue("CREATED" as const),
    };
    const useCase = new ProcessWhatsappEvent(store);
    const envelope = whatsappInboundStatusEnvelopeSchema.parse({
      ...envelopeBase,
      eventType: "whatsapp.message.status",
      payload: {
        kind: "STATUS",
        phoneNumberId: "778899",
        status: {
          errors: [{ code: 131026, title: "Message undeliverable" }],
          id: "wamid.outbound",
          recipient_id: "573001112233",
          status: "failed",
          timestamp: "1760000001",
        },
      },
    });

    await expect(useCase.processStatus(envelope)).resolves.toEqual({ result: "UPDATED" });
    expect(store.persistStatus).toHaveBeenCalledWith({
      errorCode: "131026",
      integrationId: "int_test",
      occurredAt: new Date(1_760_000_001_000).toISOString(),
      providerMessageId: "wamid.outbound",
      status: "FAILED",
      statusEventId: "wamid.outbound:failed:1760000001",
    });
  });

  it("ignores unsupported inbound message types", async () => {
    const store = {
      persistStatus: vi.fn().mockResolvedValue("UPDATED" as const),
      persistTextMessage: vi.fn().mockResolvedValue("CREATED" as const),
    };
    const useCase = new ProcessWhatsappEvent(store);
    const envelope = whatsappInboundMessageEnvelopeSchema.parse({
      ...envelopeBase,
      eventType: "whatsapp.message.received",
      payload: {
        kind: "MESSAGE",
        message: {
          from: "573001112233",
          id: "wamid.image",
          timestamp: "1760000000",
          type: "image",
        },
        phoneNumberId: "778899",
      },
    });

    await expect(useCase.processMessage(envelope)).resolves.toEqual({ result: "IGNORED" });
    expect(store.persistTextMessage).not.toHaveBeenCalled();
  });
});
