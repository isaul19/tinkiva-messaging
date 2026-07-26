import type { WhatsappCredentialReader } from "../ports/whatsapp-credential-vault.js";
import type { WhatsappMessageApi } from "../ports/whatsapp-message-api.js";
import type { WhatsappSendStore } from "../ports/whatsapp-send-store.js";
import type { WhatsappOutboundEnvelope } from "../../contracts/queues/whatsapp-outbound.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface SendWhatsappMessageResult {
  status: "FAILED" | "SENT" | "TERMINAL";
}

export class SendWhatsappMessage {
  readonly #api: WhatsappMessageApi;
  readonly #credentials: WhatsappCredentialReader;
  readonly #store: WhatsappSendStore;

  public constructor(
    store: WhatsappSendStore,
    credentials: WhatsappCredentialReader,
    api: WhatsappMessageApi,
  ) {
    this.#api = api;
    this.#credentials = credentials;
    this.#store = store;
  }

  public async execute(envelope: WhatsappOutboundEnvelope): Promise<SendWhatsappMessageResult> {
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
      const credential = await this.#credentials.get(claimed.credentialRef);
      const result = await this.#api.sendText({
        accessToken: credential.accessToken,
        graphApiVersion: claimed.graphApiVersion,
        phoneNumberId: claimed.phoneNumberId,
        recipientId: claimed.recipientId,
        text: claimed.text,
      });
      await this.#store.markSent({
        conversationId: claimed.conversationId,
        integrationId,
        messageId: envelope.payload.messageId,
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
    throw new Error(`WhatsApp outbound envelope is missing ${fieldName}.`);
  }

  return value;
};
