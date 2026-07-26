import { describe, expect, it, vi } from "vitest";

import { QueueMessage } from "../../../src/application/messages/queue-message.js";
import type { QueueMessageCommand } from "../../../src/application/messages/queue-message.js";

const command: QueueMessageCommand = {
  applicationId: "app_test",
  correlationId: "corr_test",
  idempotencyKey: "idem_test",
  request: {
    content: {
      text: { body: "Hola" },
      type: "TEXT",
    },
    integrationId: "int_test",
    recipient: {
      type: "WHATSAPP_PHONE",
      value: "573001112233",
    },
    tenantId: "tenant_test",
  },
};

describe("QueueMessage", () => {
  it("dispatches Telegram integrations to the Telegram queue", async () => {
    const integrations = {
      getProvider: vi.fn().mockResolvedValue("TELEGRAM" as const),
    };
    const telegram = {
      execute: vi.fn().mockResolvedValue({
        idempotencyKey: "idem_test",
        messageId: "msg_telegram",
        status: "QUEUED" as const,
      }),
    };
    const whatsapp = {
      execute: vi.fn(),
    };
    const useCase = new QueueMessage(integrations, telegram, whatsapp);

    await expect(useCase.execute(command)).resolves.toMatchObject({
      messageId: "msg_telegram",
    });
    expect(telegram.execute).toHaveBeenCalledWith(command);
    expect(whatsapp.execute).not.toHaveBeenCalled();
  });

  it("dispatches WhatsApp integrations to the WhatsApp queue", async () => {
    const integrations = {
      getProvider: vi.fn().mockResolvedValue("WHATSAPP" as const),
    };
    const telegram = {
      execute: vi.fn(),
    };
    const whatsapp = {
      execute: vi.fn().mockResolvedValue({
        idempotencyKey: "idem_test",
        messageId: "msg_whatsapp",
        status: "QUEUED" as const,
      }),
    };
    const useCase = new QueueMessage(integrations, telegram, whatsapp);

    await expect(useCase.execute(command)).resolves.toMatchObject({
      messageId: "msg_whatsapp",
    });
    expect(integrations.getProvider).toHaveBeenCalledWith({
      applicationId: "app_test",
      integrationId: "int_test",
      tenantId: "tenant_test",
    });
    expect(whatsapp.execute).toHaveBeenCalledWith(command);
    expect(telegram.execute).not.toHaveBeenCalled();
  });
});
