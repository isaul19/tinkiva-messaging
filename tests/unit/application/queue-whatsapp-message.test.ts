import { describe, expect, it, vi } from "vitest";

import { QueueWhatsappMessage } from "../../../src/application/messages/queue-whatsapp-message.js";
import type { SendMessageRequest } from "../../../src/contracts/api/message.contract.js";

const directRequest: SendMessageRequest = {
  clientReferenceId: "crm-123",
  content: {
    text: { body: "Hola desde Tinkiva" },
    type: "TEXT",
  },
  integrationId: "int_test",
  recipient: {
    type: "WHATSAPP_PHONE",
    value: "+573001112233",
  },
  tenantId: "tenant_test",
};

const createDependencies = () => {
  const store = {
    markEnqueued: vi.fn().mockResolvedValue(undefined),
    reserveWhatsappMessage: vi.fn().mockResolvedValue({
      messageId: "msg_test",
      status: "CREATED" as const,
    }),
    resolveWhatsappDestination: vi.fn().mockResolvedValue({
      conversationId: "conv_test",
      createDestinationRecords: true,
      recipientId: "573001112233",
      recipientType: "WHATSAPP_PHONE" as const,
    }),
  };
  const publisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return { publisher, store };
};

describe("QueueWhatsappMessage", () => {
  it("reserves, publishes, and marks a new direct-recipient message as enqueued", async () => {
    const dependencies = createDependencies();
    const useCase = new QueueWhatsappMessage(dependencies.store, dependencies.publisher);

    await expect(
      useCase.execute({
        applicationId: "app_test",
        correlationId: "corr_test",
        idempotencyKey: "idem_test",
        request: directRequest,
      }),
    ).resolves.toEqual({
      idempotencyKey: "idem_test",
      messageId: "msg_test",
      status: "QUEUED",
    });

    expect(dependencies.store.resolveWhatsappDestination).toHaveBeenCalledWith({
      applicationId: "app_test",
      integrationId: "int_test",
      recipient: directRequest.recipient,
      tenantId: "tenant_test",
    });
    expect(dependencies.store.reserveWhatsappMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientReferenceId: "crm-123",
        conversationId: "conv_test",
        createDestinationRecords: true,
        recipientId: "573001112233",
        recipientType: "WHATSAPP_PHONE",
        content: { text: "Hola desde Tinkiva", type: "TEXT" },
      }),
    );
    expect(dependencies.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "whatsapp.message.send",
        payload: {
          content: directRequest.content,
          conversationId: "conv_test",
          messageId: "msg_test",
          recipientId: "573001112233",
          recipientType: "WHATSAPP_PHONE",
        },
      }),
    );
    expect(dependencies.store.markEnqueued).toHaveBeenCalledOnce();
  });

  it("returns an existing idempotent reservation without publishing again", async () => {
    const dependencies = createDependencies();
    dependencies.store.resolveWhatsappDestination.mockResolvedValue({
      conversationId: "conv_existing",
      createDestinationRecords: false,
      recipientId: "bsuid_123",
      recipientType: "WHATSAPP_BSUID",
    });
    dependencies.store.reserveWhatsappMessage.mockResolvedValue({
      messageId: "msg_existing",
      status: "ENQUEUED",
    });
    const useCase = new QueueWhatsappMessage(dependencies.store, dependencies.publisher);
    const request: SendMessageRequest = {
      content: {
        text: { body: "Seguimiento" },
        type: "TEXT",
      },
      conversationId: "conv_existing",
      integrationId: "int_test",
      tenantId: "tenant_test",
    };

    await expect(
      useCase.execute({
        applicationId: "app_test",
        correlationId: "corr_test",
        idempotencyKey: "idem_existing",
        request,
      }),
    ).resolves.toEqual({
      idempotencyKey: "idem_existing",
      messageId: "msg_existing",
      status: "QUEUED",
    });

    expect(dependencies.store.resolveWhatsappDestination).toHaveBeenCalledWith({
      applicationId: "app_test",
      conversationId: "conv_existing",
      integrationId: "int_test",
      tenantId: "tenant_test",
    });
    expect(dependencies.publisher.publish).not.toHaveBeenCalled();
    expect(dependencies.store.markEnqueued).not.toHaveBeenCalled();
  });

  it("rejects unsupported media before resolving a destination", async () => {
    const dependencies = createDependencies();
    const useCase = new QueueWhatsappMessage(dependencies.store, dependencies.publisher);
    const request: SendMessageRequest = {
      content: {
        media: { mediaId: "media_test" },
        type: "IMAGE",
      },
      integrationId: "int_test",
      recipient: {
        type: "WHATSAPP_PHONE",
        value: "573001112233",
      },
      tenantId: "tenant_test",
    };

    await expect(
      useCase.execute({
        applicationId: "app_test",
        correlationId: "corr_test",
        idempotencyKey: "idem_media",
        request,
      }),
    ).rejects.toMatchObject({
      code: "MESSAGE_NOT_SENDABLE",
      statusCode: 422,
    });
    expect(dependencies.store.resolveWhatsappDestination).not.toHaveBeenCalled();
  });
});
