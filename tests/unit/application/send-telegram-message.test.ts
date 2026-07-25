/* eslint-disable @typescript-eslint/unbound-method -- Vitest spy assertions intentionally reference mock methods. */
import { describe, expect, it, vi } from "vitest";

import type { TelegramCredentialReader } from "../../../src/application/ports/telegram-credential-vault.js";
import type { TelegramMessageApi } from "../../../src/application/ports/telegram-message-api.js";
import type { TelegramSendStore } from "../../../src/application/ports/telegram-send-store.js";
import { SendTelegramMessage } from "../../../src/application/telegram/send-telegram-message.js";
import type { TelegramOutboundEnvelope } from "../../../src/contracts/queues/telegram-outbound.contract.js";
import { ApplicationError } from "../../../src/shared/errors/application-error.js";

const envelope: TelegramOutboundEnvelope = {
  applicationId: "app_demo",
  correlationId: "cor_demo",
  eventId: "evt_demo",
  eventType: "telegram.message.send",
  integrationId: "int_demo",
  occurredAt: "2026-07-25T12:00:00.000Z",
  payload: {
    chatId: "123",
    content: {
      text: { body: "Hola" },
      type: "TEXT",
    },
    conversationId: "conv_demo",
    messageId: "msg_demo",
  },
  schemaVersion: 1,
  tenantId: "tenant_demo",
};

const claimed = {
  chatId: "123",
  conversationId: "conv_demo",
  messageSortKey: "MESSAGE#date#msg_demo",
  credentialRef: "pc_demo",
  status: "CLAIMED" as const,
  text: "Hola",
};

const createDependencies = () => {
  const store: TelegramSendStore = {
    acquire: vi.fn().mockResolvedValue(claimed),
    markFailed: vi.fn().mockResolvedValue(undefined),
    markSent: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const secrets: TelegramCredentialReader = {
    get: vi.fn().mockResolvedValue({
      botToken: "not-logged",
      webhookSecretToken: "webhook-secret",
    }),
  };
  const api: TelegramMessageApi = {
    sendText: vi.fn().mockResolvedValue({
      providerMessageId: "42",
    }),
  };

  return { api, secrets, store };
};

describe("SendTelegramMessage", () => {
  it("loads the secret, sends text, and marks the message as sent", async () => {
    const { api, secrets, store } = createDependencies();
    const service = new SendTelegramMessage(store, secrets, api);

    await expect(service.execute(envelope)).resolves.toEqual({ status: "SENT" });
    expect(api.sendText).toHaveBeenCalledWith({
      botToken: "not-logged",
      chatId: "123",
      text: "Hola",
    });
    expect(store.markSent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageId: "42",
      }),
    );
  });

  it("does nothing for an already terminal message", async () => {
    const { api, secrets, store } = createDependencies();
    vi.mocked(store.acquire).mockResolvedValue({ status: "TERMINAL" });
    const service = new SendTelegramMessage(store, secrets, api);

    await expect(service.execute(envelope)).resolves.toEqual({ status: "TERMINAL" });
    expect(secrets.get).not.toHaveBeenCalled();
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("marks a provider rejection as failed without retrying the SQS record", async () => {
    const { api, secrets, store } = createDependencies();
    vi.mocked(api.sendText).mockRejectedValue(
      new ApplicationError("MESSAGE_NOT_SENDABLE", "Rejected.", 422),
    );
    const service = new SendTelegramMessage(store, secrets, api);

    await expect(service.execute(envelope)).resolves.toEqual({ status: "FAILED" });
    expect(store.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "MESSAGE_NOT_SENDABLE",
      }),
    );
    expect(store.release).not.toHaveBeenCalled();
  });

  it("releases a retryable provider failure and rethrows it", async () => {
    const { api, secrets, store } = createDependencies();
    const failure = new ApplicationError("PROVIDER_UNAVAILABLE", "Unavailable.", 503, true);
    vi.mocked(api.sendText).mockRejectedValue(failure);
    const service = new SendTelegramMessage(store, secrets, api);

    await expect(service.execute(envelope)).rejects.toBe(failure);
    expect(store.release).toHaveBeenCalledOnce();
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it("rejects an envelope without tenant context", async () => {
    const { api, secrets, store } = createDependencies();
    const service = new SendTelegramMessage(store, secrets, api);

    await expect(
      service.execute({
        ...envelope,
        tenantId: undefined,
      }),
    ).rejects.toThrow("tenantId");
  });
});
