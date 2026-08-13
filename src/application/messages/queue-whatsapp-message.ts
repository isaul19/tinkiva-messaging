import { ulid } from "ulid";

import type { WhatsappOutboundPublisher } from "../ports/whatsapp-outbound-publisher.js";
import type {
  ReservedWhatsappMessage,
  WhatsappOutgoingMessageStore,
} from "../ports/whatsapp-outgoing-message-store.js";
import type { OutboundAudioImporter, OutboundImageImporter } from "../ports/media.js";
import type { StoredOutgoingContent } from "../ports/outgoing-message-store.js";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "../../contracts/api/message.contract.js";
import { hashCanonicalJson } from "../../shared/crypto/request-hash.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const WHATSAPP_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"];
const WHATSAPP_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface QueueWhatsappMessageCommand {
  applicationId: string;
  correlationId: string;
  idempotencyKey: string;
  request: SendMessageRequest;
}

export class QueueWhatsappMessage {
  readonly #media: (OutboundImageImporter & Partial<OutboundAudioImporter>) | undefined;
  readonly #publisher: WhatsappOutboundPublisher;
  readonly #store: WhatsappOutgoingMessageStore;

  public constructor(
    store: WhatsappOutgoingMessageStore,
    publisher: WhatsappOutboundPublisher,
    media?: OutboundImageImporter & Partial<OutboundAudioImporter>,
  ) {
    this.#media = media;
    this.#publisher = publisher;
    this.#store = store;
  }

  public async execute(command: QueueWhatsappMessageCommand): Promise<SendMessageResponse> {
    const content = command.request.content;
    if (
      content.type !== "TEXT" &&
      (this.#media === undefined ||
        (content.type === "AUDIO" && this.#media.importAudio === undefined))
    ) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Media sending is not configured.", 422);
    }
    const destination = await this.#store.resolveWhatsappDestination({
      applicationId: command.applicationId,
      ...(command.request.conversationId === undefined
        ? {}
        : { conversationId: command.request.conversationId }),
      integrationId: command.request.integrationId,
      ...(command.request.recipient === undefined ? {} : { recipient: command.request.recipient }),
      tenantId: command.request.tenantId,
    });
    const occurredAt = new Date().toISOString();
    const requestHash = hashCanonicalJson(command.request);
    const messageId = `msg_${ulid()}`;
    const storedContent = await this.#storedContent(command, `request_${requestHash}`);
    const reserved = await this.#store.reserveWhatsappMessage({
      applicationId: command.applicationId,
      ...(command.request.clientReferenceId === undefined
        ? {}
        : { clientReferenceId: command.request.clientReferenceId }),
      conversationId: destination.conversationId,
      createDestinationRecords: destination.createDestinationRecords,
      idempotencyKey: command.idempotencyKey,
      integrationId: command.request.integrationId,
      messageId,
      occurredAt,
      recipientId: destination.recipientId,
      recipientType: destination.recipientType,
      requestHash,
      tenantId: command.request.tenantId,
      content: storedContent,
    });

    if (reserved.status === "CREATED") {
      await this.#publish(command, content, destination, reserved, occurredAt);
      await this.#store.markEnqueued({
        applicationId: command.applicationId,
        enqueuedAt: new Date().toISOString(),
        idempotencyKey: command.idempotencyKey,
        messageId: reserved.messageId,
        requestHash,
      });
    }

    return {
      idempotencyKey: command.idempotencyKey,
      messageId: reserved.messageId,
      status: "QUEUED",
    };
  }

  async #publish(
    command: QueueWhatsappMessageCommand,
    content: SendMessageRequest["content"],
    destination: {
      conversationId: string;
      recipientId: string;
      recipientType: "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
    },
    reserved: ReservedWhatsappMessage,
    occurredAt: string,
  ): Promise<void> {
    await this.#publisher.publish({
      applicationId: command.applicationId,
      correlationId: command.correlationId,
      eventId: `evt_${ulid()}`,
      eventType: "whatsapp.message.send",
      integrationId: command.request.integrationId,
      occurredAt,
      payload: {
        content,
        conversationId: destination.conversationId,
        messageId: reserved.messageId,
        recipientId: destination.recipientId,
        recipientType: destination.recipientType,
      },
      schemaVersion: 1,
      tenantId: command.request.tenantId,
    });
  }

  async #storedContent(
    command: QueueWhatsappMessageCommand,
    messageId: string,
  ): Promise<StoredOutgoingContent> {
    const content = command.request.content;
    if (content.type === "TEXT") return { text: content.text.body, type: "TEXT" };
    if (this.#media === undefined) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Media sending is not configured.", 422);
    }
    const caption = content.media.text ?? content.media.caption;
    if (content.type === "AUDIO") {
      if (this.#media.importAudio === undefined) {
        throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Audio sending is not configured.", 422);
      }
      const media = await this.#media.importAudio({
        acceptedMimeTypes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
        applicationId: command.applicationId,
        maxSizeBytes: 16 * 1024 * 1024,
        ...(content.media.mediaId === undefined ? {} : { mediaId: content.media.mediaId }),
        messageId,
        ...(content.media.url === undefined ? {} : { sourceUrl: content.media.url }),
        tenantId: command.request.tenantId,
      });
      return {
        ...(caption === undefined ? {} : { caption }),
        media,
        type: "AUDIO",
        voice: false,
      };
    }
    const media = await this.#media.importImage({
      acceptedMimeTypes: WHATSAPP_IMAGE_MIME_TYPES,
      applicationId: command.applicationId,
      maxSizeBytes: WHATSAPP_MAX_IMAGE_BYTES,
      ...(content.media.mediaId === undefined ? {} : { mediaId: content.media.mediaId }),
      messageId,
      ...(content.media.url === undefined ? {} : { sourceUrl: content.media.url }),
      tenantId: command.request.tenantId,
    });
    return {
      ...(caption === undefined ? {} : { caption }),
      media,
      type: "IMAGE",
    };
  }
}
