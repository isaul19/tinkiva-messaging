import { describe, expect, it, vi } from "vitest";
import type { TelegramCredentialReader } from "../../../src/application/ports/telegram-credential-vault.js";
import type {
  TelegramInboundEvent,
  TelegramInboundPublisher,
} from "../../../src/application/ports/telegram-inbound-publisher.js";
import type {
  TelegramIntegrationReader,
  TelegramWebhookIntegration,
} from "../../../src/application/ports/telegram-integration-reader.js";
import { ReceiveTelegramUpdate } from "../../../src/application/telegram/receive-telegram-update.js";
import { telegramUpdateSchema } from "../../../src/contracts/providers/telegram.contract.js";

const webhookSecret = "telegram-webhook-secret-token-000000000001";

class FakeIntegrationReader implements TelegramIntegrationReader {
  public integration: TelegramWebhookIntegration | undefined = {
    applicationId: "app_test",
    integrationId: "int_telegram",
    credentialRef: "pc_telegram",
    status: "ACTIVE",
    tenantId: "tenant_test",
  };

  public getByWebhookKey(): Promise<TelegramWebhookIntegration | undefined> {
    return Promise.resolve(this.integration);
  }
}

class FakeCredentialReader implements TelegramCredentialReader {
  public get(): Promise<{ botToken: string; webhookSecretToken: string }> {
    return Promise.resolve({
      botToken: "123456789:bot-token-value-for-tests",
      webhookSecretToken: webhookSecret,
    });
  }
}

class FakePublisher implements TelegramInboundPublisher {
  public readonly publish = vi.fn<(event: TelegramInboundEvent) => Promise<void>>(() =>
    Promise.resolve(),
  );
}

const textUpdate = telegramUpdateSchema.parse({
  message: {
    chat: {
      id: -1_000_000_001,
      title: "Tinkiva support",
      type: "supergroup",
    },
    date: 1_785_000_000,
    from: {
      first_name: "Saul",
      id: 42,
      is_bot: false,
      username: "mutable_username",
    },
    message_id: 17,
    text: "Hola",
  },
  update_id: 9001,
});

describe("ReceiveTelegramUpdate", () => {
  it("verifies the secret and enqueues a supported update by chat", async () => {
    const publisher = new FakePublisher();
    const useCase = new ReceiveTelegramUpdate(
      new FakeIntegrationReader(),
      new FakeCredentialReader(),
      publisher,
    );

    await expect(
      useCase.execute({
        correlationId: "cor_telegram",
        secretToken: webhookSecret,
        update: textUpdate,
        webhookKey: "w".repeat(48),
      }),
    ).resolves.toEqual({
      accepted: true,
      enqueued: true,
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app_test",
        chatId: "-1000000001",
        integrationId: "int_telegram",
        tenantId: "tenant_test",
      }),
    );
  });

  it("rejects an invalid webhook secret without publishing", async () => {
    const publisher = new FakePublisher();
    const useCase = new ReceiveTelegramUpdate(
      new FakeIntegrationReader(),
      new FakeCredentialReader(),
      publisher,
    );

    await expect(
      useCase.execute({
        correlationId: "cor_telegram",
        secretToken: "incorrect",
        update: textUpdate,
        webhookKey: "w".repeat(48),
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_SIGNATURE_INVALID",
      statusCode: 401,
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("hides missing integrations and accepts unsupported updates without queueing", async () => {
    const integrations = new FakeIntegrationReader();
    const publisher = new FakePublisher();
    const useCase = new ReceiveTelegramUpdate(integrations, new FakeCredentialReader(), publisher);
    integrations.integration = undefined;

    await expect(
      useCase.execute({
        correlationId: "cor_telegram",
        secretToken: webhookSecret,
        update: textUpdate,
        webhookKey: "w".repeat(48),
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_NOT_FOUND",
      statusCode: 404,
    });

    integrations.integration = {
      applicationId: "app_test",
      integrationId: "int_telegram",
      credentialRef: "pc_telegram",
      status: "ACTIVE",
      tenantId: "tenant_test",
    };

    await expect(
      useCase.execute({
        correlationId: "cor_telegram",
        secretToken: webhookSecret,
        update: telegramUpdateSchema.parse({ update_id: 9002 }),
        webhookKey: "w".repeat(48),
      }),
    ).resolves.toEqual({
      accepted: true,
      enqueued: false,
    });
  });
});
