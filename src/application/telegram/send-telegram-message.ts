import type { SecretReader } from "../ports/secret-reader.js";
import type { TelegramMessageApi } from "../ports/telegram-message-api.js";
import type { TelegramSendStore } from "../ports/telegram-send-store.js";
import type { TelegramOutboundEnvelope } from "../../contracts/queues/telegram-outbound.contract.js";
import { telegramSecretSchema } from "../../contracts/providers/telegram.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface SendTelegramMessageResult {
  status: "FAILED" | "SENT" | "TERMINAL";
}

export class SendTelegramMessage {
  readonly #api: TelegramMessageApi;
  readonly #secrets: SecretReader;
  readonly #store: TelegramSendStore;

  public constructor(store: TelegramSendStore, secrets: SecretReader, api: TelegramMessageApi) {
    this.#api = api;
    this.#secrets = secrets;
    this.#store = store;
  }

  public async execute(envelope: TelegramOutboundEnvelope): Promise<SendTelegramMessageResult> {
    const applicationId = required(envelope.applicationId, "applicationId");
    const integrationId = required(envelope.integrationId, "integrationId");
    const tenantId = required(envelope.tenantId, "tenantId");
    const claimed = await this.#store.acquire({
      applicationId,
      integrationId,
      messageId: envelope.payload.messageId,
      tenantId,
    });

    if (claimed.status === "TERMINAL") {
      return { status: "TERMINAL" };
    }

    try {
      const secret = await this.#secrets.getJson(claimed.secretArn, telegramSecretSchema);
      const result = await this.#api.sendText({
        botToken: secret.botToken,
        chatId: claimed.chatId,
        text: claimed.text,
      });
      await this.#store.markSent({
        conversationId: claimed.conversationId,
        messageSortKey: claimed.messageSortKey,
        providerMessageId: result.providerMessageId,
        sentAt: new Date().toISOString(),
      });

      return { status: "SENT" };
    } catch (error) {
      if (error instanceof ApplicationError && !error.retryable) {
        await this.#store.markFailed({
          conversationId: claimed.conversationId,
          failedAt: new Date().toISOString(),
          failureCode: error.code,
          messageSortKey: claimed.messageSortKey,
        });

        return { status: "FAILED" };
      }

      await this.#store.release({
        conversationId: claimed.conversationId,
        messageSortKey: claimed.messageSortKey,
        releasedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}

const required = (value: string | undefined, fieldName: string): string => {
  if (value === undefined) {
    throw new Error(`Telegram outbound envelope is missing ${fieldName}.`);
  }

  return value;
};
