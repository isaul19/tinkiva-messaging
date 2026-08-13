import { ulid } from "ulid";

import type {
  OutgoingMessageStore,
  ReservedTelegramMessage,
  StoredOutgoingContent,
} from "../ports/outgoing-message-store.js";
import type { OutboundAudioImporter, OutboundImageImporter } from "../ports/media.js";
import type { TelegramOutboundPublisher } from "../ports/telegram-outbound-publisher.js";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "../../contracts/api/message.contract.js";
import { hashCanonicalJson } from "../../shared/crypto/request-hash.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface QueueTelegramMessageCommand {
  applicationId: string;
  correlationId: string;
  idempotencyKey: string;
  request: SendMessageRequest;
}

export class QueueTelegramMessage {
  readonly #media: (OutboundImageImporter & Partial<OutboundAudioImporter>) | undefined;
  readonly #publisher: TelegramOutboundPublisher;
  readonly #store: OutgoingMessageStore;

  public constructor(
    store: OutgoingMessageStore,
    publisher: TelegramOutboundPublisher,
    media?: OutboundImageImporter & Partial<OutboundAudioImporter>,
  ) {
    this.#media = media;
    this.#store = store;
    this.#publisher = publisher;
  }

  public async execute(command: QueueTelegramMessageCommand): Promise<SendMessageResponse> {
    const content = command.request.content;
    if (
      content.type !== "TEXT" &&
      (this.#media === undefined ||
        (content.type === "AUDIO" && this.#media.importAudio === undefined))
    ) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "Media sending is not configured.", 422);
    }
    const destination = await this.#store.resolveTelegramDestination({
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
    const reserved = await this.#store.reserveTelegramMessage({
      applicationId: command.applicationId,
      chatId: destination.chatId,
      ...(command.request.clientReferenceId === undefined
        ? {}
        : { clientReferenceId: command.request.clientReferenceId }),
      conversationId: destination.conversationId,
      createDestinationRecords: destination.createDestinationRecords,
      idempotencyKey: command.idempotencyKey,
      integrationId: command.request.integrationId,
      messageId,
      occurredAt,
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
    command: QueueTelegramMessageCommand,
    content: SendMessageRequest["content"],
    destination: { chatId: string; conversationId: string },
    reserved: ReservedTelegramMessage,
    occurredAt: string,
  ): Promise<void> {
    await this.#publisher.publish({
      applicationId: command.applicationId,
      correlationId: command.correlationId,
      eventId: `evt_${ulid()}`,
      eventType: "telegram.message.send",
      integrationId: command.request.integrationId,
      occurredAt,
      payload: {
        chatId: destination.chatId,
        content,
        conversationId: destination.conversationId,
        messageId: reserved.messageId,
      },
      schemaVersion: 1,
      tenantId: command.request.tenantId,
    });
  }

  async #storedContent(
    command: QueueTelegramMessageCommand,
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
        acceptedMimeTypes: ["audio/mpeg", "audio/mp4"],
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
      applicationId: command.applicationId,
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
