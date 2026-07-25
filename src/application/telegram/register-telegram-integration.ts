import { randomBytes } from "node:crypto";

import { ulid } from "ulid";

import type { TelegramBotApi } from "../ports/telegram-bot-api.js";
import type { TelegramIntegrationStore } from "../ports/telegram-integration-store.js";
import type { TelegramCredentialWriter } from "../ports/telegram-credential-vault.js";
import type {
  RegisterTelegramIntegrationRequest,
  TelegramIntegrationResponse,
} from "../../contracts/api/integration.contract.js";

export interface RegisterTelegramIntegrationCommand {
  applicationId: string;
  request: RegisterTelegramIntegrationRequest;
  tenantId: string;
}

export interface RegisterTelegramIntegrationConfig {
  webhookBaseUrl: string;
}

export class RegisterTelegramIntegration {
  readonly #botApi: TelegramBotApi;
  readonly #config: RegisterTelegramIntegrationConfig;
  readonly #secrets: TelegramCredentialWriter;
  readonly #store: TelegramIntegrationStore;

  public constructor(
    botApi: TelegramBotApi,
    secrets: TelegramCredentialWriter,
    store: TelegramIntegrationStore,
    config: RegisterTelegramIntegrationConfig,
  ) {
    this.#botApi = botApi;
    this.#secrets = secrets;
    this.#store = store;
    this.#config = config;
  }

  public async execute(
    command: RegisterTelegramIntegrationCommand,
  ): Promise<TelegramIntegrationResponse> {
    const bot = await this.#botApi.getMe(command.request.botToken);
    const providerConnectionId = `pc_${ulid()}`;
    const integrationId = `int_${ulid()}`;
    const webhookKey = randomBytes(32).toString("base64url");
    const webhookSecretToken = randomBytes(32).toString("base64url");
    const webhookUrl = `${this.#config.webhookBaseUrl.replace(/\/+$/, "")}/webhooks/telegram/${webhookKey}`;
    const credentialRef = await this.#secrets.create({
      applicationId: command.applicationId,
      botToken: command.request.botToken,
      providerConnectionId,
      tenantId: command.tenantId,
      webhookSecretToken,
    });
    const createdAt = new Date().toISOString();

    try {
      await this.#store.createPending({
        applicationId: command.applicationId,
        botId: bot.id,
        ...(bot.username === undefined ? {} : { botUsername: bot.username }),
        createdAt,
        displayName: command.request.displayName,
        integrationId,
        providerConnectionId,
        credentialRef,
        tenantId: command.tenantId,
        webhookKey,
        webhookUrl,
      });
    } catch (error) {
      await this.#secrets.deleteImmediately(credentialRef);
      throw error;
    }

    try {
      await this.#botApi.setWebhook({
        botToken: command.request.botToken,
        dropPendingUpdates: command.request.dropPendingUpdates ?? false,
        secretToken: webhookSecretToken,
        url: webhookUrl,
      });
      await this.#store.setStatus(
        integrationId,
        providerConnectionId,
        command.tenantId,
        webhookKey,
        "ACTIVE",
        new Date().toISOString(),
      );
    } catch (error) {
      await this.#store.setStatus(
        integrationId,
        providerConnectionId,
        command.tenantId,
        webhookKey,
        "ERROR",
        new Date().toISOString(),
      );
      throw error;
    }

    return {
      botId: bot.id,
      ...(bot.username === undefined ? {} : { botUsername: bot.username }),
      displayName: command.request.displayName,
      integrationId,
      provider: "TELEGRAM",
      status: "ACTIVE",
      tenantId: command.tenantId,
      webhookUrl,
    };
  }
}
