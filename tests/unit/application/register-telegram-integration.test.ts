import { describe, expect, it, vi } from "vitest";

import type {
  TelegramBotApi,
  TelegramBotIdentity,
} from "../../../src/application/ports/telegram-bot-api.js";
import type {
  CreateTelegramIntegrationRecords,
  TelegramIntegrationStore,
} from "../../../src/application/ports/telegram-integration-store.js";
import type { TelegramCredentialWriter } from "../../../src/application/ports/telegram-credential-vault.js";
import { RegisterTelegramIntegration } from "../../../src/application/telegram/register-telegram-integration.js";

const botToken = "123456789:telegram-bot-token-for-unit-tests";

interface SetWebhookCall {
  botToken: string;
  dropPendingUpdates: boolean;
  secretToken: string;
  url: string;
}

class FakeBotApi implements TelegramBotApi {
  public failSetWebhook = false;
  public readonly setWebhookCalls: SetWebhookCall[] = [];

  public getMe(): Promise<TelegramBotIdentity> {
    return Promise.resolve({
      firstName: "Tinkiva Bot",
      id: "123456789",
      username: "tinkiva_test_bot",
    });
  }

  public setWebhook(input: SetWebhookCall): Promise<void> {
    this.setWebhookCalls.push(input);
    return this.failSetWebhook
      ? Promise.reject(new Error("Telegram unavailable"))
      : Promise.resolve();
  }
}

class FakeCredentialWriter implements TelegramCredentialWriter {
  public readonly create = vi.fn(() => Promise.resolve("pc_test"));
  public readonly deleteImmediately = vi.fn(() => Promise.resolve());
}

class FakeIntegrationStore implements TelegramIntegrationStore {
  public createError: Error | undefined;
  public created: CreateTelegramIntegrationRecords | undefined;
  public readonly statuses: ("ACTIVE" | "ERROR")[] = [];

  public createPending(input: CreateTelegramIntegrationRecords): Promise<void> {
    this.created = input;
    return this.createError === undefined ? Promise.resolve() : Promise.reject(this.createError);
  }

  public setStatus(
    _integrationId: string,
    _providerConnectionId: string,
    _tenantId: string,
    _webhookKey: string,
    status: "ACTIVE" | "ERROR",
  ): Promise<void> {
    this.statuses.push(status);
    return Promise.resolve();
  }
}

const createUseCase = (
  botApi = new FakeBotApi(),
  secrets = new FakeCredentialWriter(),
  store = new FakeIntegrationStore(),
) => ({
  botApi,
  secrets,
  store,
  useCase: new RegisterTelegramIntegration(botApi, secrets, store, {
    webhookBaseUrl: "https://gateway.example/",
  }),
});

describe("RegisterTelegramIntegration", () => {
  it("stores only an encrypted credential reference and activates the webhook", async () => {
    const { botApi, secrets, store, useCase } = createUseCase();

    const result = await useCase.execute({
      applicationId: "app_test",
      request: {
        botToken,
        displayName: "Support bot",
        dropPendingUpdates: true,
        inboundMedia: {
          audioAlternativeText: true,
          imageAlternativeText: false,
        },
      },
      tenantId: "tenant_test",
    });

    expect(result).toMatchObject({
      botId: "123456789",
      botUsername: "tinkiva_test_bot",
      displayName: "Support bot",
      inboundMedia: {
        audioAlternativeText: true,
        imageAlternativeText: false,
      },
      provider: "TELEGRAM",
      status: "ACTIVE",
      tenantId: "tenant_test",
    });
    expect(JSON.stringify(result)).not.toContain(botToken);
    expect(secrets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        botToken,
        tenantId: "tenant_test",
      }),
    );
    expect(store.created).toMatchObject({
      applicationId: "app_test",
      botId: "123456789",
      inboundMedia: {
        audioAlternativeText: true,
        imageAlternativeText: false,
      },
    });
    expect(store.created?.credentialRef).toBe("pc_test");
    expect(store.statuses).toEqual(["ACTIVE"]);
    const setWebhookCall = botApi.setWebhookCalls[0];
    expect(setWebhookCall?.dropPendingUpdates).toBe(true);
    expect(setWebhookCall?.url).toMatch(
      /^https:\/\/gateway\.example\/webhooks\/telegram\/[0-9A-Za-z_-]+$/,
    );
    expect(setWebhookCall?.secretToken).toHaveLength(43);
  });

  it("deletes a newly created orphan credential when persistence fails", async () => {
    const dependencies = createUseCase();
    dependencies.store.createError = new Error("DynamoDB rejected the transaction");

    await expect(
      dependencies.useCase.execute({
        applicationId: "app_test",
        request: {
          botToken,
          displayName: "Support bot",
          inboundMedia: {
            audioAlternativeText: false,
            imageAlternativeText: false,
          },
        },
        tenantId: "tenant_test",
      }),
    ).rejects.toThrow("DynamoDB rejected");

    expect(dependencies.secrets.deleteImmediately).toHaveBeenCalledWith("pc_test");
    expect(dependencies.botApi.setWebhookCalls).toHaveLength(0);
  });

  it("keeps the integration visible as ERROR when Telegram setWebhook fails", async () => {
    const dependencies = createUseCase();
    dependencies.botApi.failSetWebhook = true;

    await expect(
      dependencies.useCase.execute({
        applicationId: "app_test",
        request: {
          botToken,
          displayName: "Support bot",
          inboundMedia: {
            audioAlternativeText: false,
            imageAlternativeText: false,
          },
        },
        tenantId: "tenant_test",
      }),
    ).rejects.toThrow("Telegram unavailable");

    expect(dependencies.store.statuses).toEqual(["ERROR"]);
    expect(dependencies.secrets.deleteImmediately).not.toHaveBeenCalled();
  });
});
