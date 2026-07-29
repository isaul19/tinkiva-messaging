import type { MediaUrlSigner } from "../ports/media.js";
import type { TelegramCredentialReader } from "../ports/telegram-credential-vault.js";
import type { TelegramMessageApi } from "../ports/telegram-message-api.js";
import type { TelegramSendStore } from "../ports/telegram-send-store.js";
import type { TelegramOutboundEnvelope } from "../../contracts/queues/telegram-outbound.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface SendTelegramMessageResult {
  status: "FAILED" | "SENT" | "TERMINAL";
}

export class SendTelegramMessage {
  readonly #api: TelegramMessageApi;
  readonly #secrets: TelegramCredentialReader;
  readonly #store: TelegramSendStore;
  readonly #media: MediaUrlSigner | undefined;

  public constructor(
    store: TelegramSendStore,
    secrets: TelegramCredentialReader,
    api: TelegramMessageApi,
    media?: MediaUrlSigner,
  ) {
    this.#api = api;
    this.#secrets = secrets;
    this.#store = store;
    this.#media = media;
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
      const secret = await this.#secrets.get(claimed.credentialRef);
      const result =
        claimed.content.type === "TEXT"
          ? await this.#api.sendText({
              botToken: secret.botToken,
              chatId: claimed.chatId,
              text: claimed.content.text,
            })
          : await this.#sendImage(secret.botToken, claimed);
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

  async #sendImage(
    botToken: string,
    claimed: Extract<Awaited<ReturnType<TelegramSendStore["acquire"]>>, { status: "CLAIMED" }>,
  ): Promise<{ providerMessageId: string }> {
    if (
      claimed.content.type !== "IMAGE" ||
      this.#media === undefined ||
      this.#api.sendImage === undefined
    ) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Image sending is not configured.", 422);
    }
    return this.#api.sendImage({
      botToken,
      ...(claimed.content.caption === undefined ? {} : { caption: claimed.content.caption }),
      chatId: claimed.chatId,
      imageUrl: await this.#media.temporaryDownloadUrl(claimed.content.media),
    });
  }
}

const required = (value: string | undefined, fieldName: string): string => {
  if (value === undefined) {
    throw new Error(`Telegram outbound envelope is missing ${fieldName}.`);
  }

  return value;
};
