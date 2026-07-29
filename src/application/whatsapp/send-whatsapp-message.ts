import type { MediaBinaryReader } from "../ports/media.js";
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
  readonly #media: MediaBinaryReader | undefined;

  public constructor(
    store: WhatsappSendStore,
    credentials: WhatsappCredentialReader,
    api: WhatsappMessageApi,
    media?: MediaBinaryReader,
  ) {
    this.#api = api;
    this.#credentials = credentials;
    this.#store = store;
    this.#media = media;
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
      const result =
        claimed.content.type === "TEXT"
          ? await this.#api.sendText({
              accessToken: credential.accessToken,
              graphApiVersion: claimed.graphApiVersion,
              phoneNumberId: claimed.phoneNumberId,
              recipientId: claimed.recipientId,
              text: claimed.content.text,
            })
          : await this.#sendImage(credential.accessToken, claimed);
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

  async #sendImage(
    accessToken: string,
    claimed: Extract<Awaited<ReturnType<WhatsappSendStore["acquire"]>>, { status: "CLAIMED" }>,
  ): Promise<{ providerMessageId: string }> {
    if (claimed.content.type !== "IMAGE" || this.#api.sendImage === undefined) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Image sending is not configured.", 422);
    }
    let providerMediaId = claimed.providerMediaId;
    if (providerMediaId === undefined) {
      if (this.#media === undefined || this.#api.uploadImage === undefined) {
        throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Image sending is not configured.", 422);
      }
      if (
        !isWhatsappImageMimeType(claimed.content.media.mimeType) ||
        claimed.content.media.sizeBytes > 5 * 1024 * 1024
      ) {
        throw new ApplicationError(
          "MEDIA_INVALID",
          "WhatsApp images must be JPEG or PNG and at most 5 MB.",
          422,
        );
      }
      const image = await this.#media.readImage(claimed.content.media);
      if (!isWhatsappImageMimeType(image.mimeType)) {
        throw new ApplicationError("MEDIA_INVALID", "WhatsApp images must be JPEG or PNG.", 422);
      }
      const uploaded = await this.#api.uploadImage({
        accessToken,
        bytes: image.bytes,
        graphApiVersion: claimed.graphApiVersion,
        mimeType: image.mimeType,
        phoneNumberId: claimed.phoneNumberId,
      });
      providerMediaId = uploaded.providerMediaId;
      await this.#store.saveProviderMediaId({
        conversationId: claimed.conversationId,
        messageSortKey: claimed.messageSortKey,
        providerMediaId,
      });
    }
    return this.#api.sendImage({
      accessToken,
      ...(claimed.content.caption === undefined ? {} : { caption: claimed.content.caption }),
      graphApiVersion: claimed.graphApiVersion,
      mediaId: providerMediaId,
      phoneNumberId: claimed.phoneNumberId,
      recipientId: claimed.recipientId,
    });
  }
}

const required = (value: string | undefined, fieldName: string): string => {
  if (value === undefined) {
    throw new Error(`WhatsApp outbound envelope is missing ${fieldName}.`);
  }

  return value;
};

const isWhatsappImageMimeType = (value: string): value is "image/jpeg" | "image/png" =>
  value === "image/jpeg" || value === "image/png";
