import { ulid } from "ulid";

import type { WhatsappOutboundPublisher } from "../ports/whatsapp-outbound-publisher.js";
import type {
  ReservedWhatsappMessage,
  WhatsappOutgoingMessageStore,
} from "../ports/whatsapp-outgoing-message-store.js";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "../../contracts/api/message.contract.js";
import { hashCanonicalJson } from "../../shared/crypto/request-hash.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface QueueWhatsappMessageCommand {
  applicationId: string;
  correlationId: string;
  idempotencyKey: string;
  request: SendMessageRequest;
}

type WhatsappTextContent = Extract<SendMessageRequest["content"], { type: "TEXT" }>;

export class QueueWhatsappMessage {
  readonly #publisher: WhatsappOutboundPublisher;
  readonly #store: WhatsappOutgoingMessageStore;

  public constructor(store: WhatsappOutgoingMessageStore, publisher: WhatsappOutboundPublisher) {
    this.#publisher = publisher;
    this.#store = store;
  }

  public async execute(command: QueueWhatsappMessageCommand): Promise<SendMessageResponse> {
    if (command.request.content.type !== "TEXT") {
      throw new ApplicationError(
        "MESSAGE_NOT_SENDABLE",
        "WhatsApp media sending is not enabled yet.",
        422,
      );
    }

    const content = command.request.content;
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
    const reserved = await this.#store.reserveWhatsappMessage({
      applicationId: command.applicationId,
      ...(command.request.clientReferenceId === undefined
        ? {}
        : { clientReferenceId: command.request.clientReferenceId }),
      conversationId: destination.conversationId,
      createDestinationRecords: destination.createDestinationRecords,
      idempotencyKey: command.idempotencyKey,
      integrationId: command.request.integrationId,
      messageId: `msg_${ulid()}`,
      occurredAt,
      recipientId: destination.recipientId,
      recipientType: destination.recipientType,
      requestHash,
      tenantId: command.request.tenantId,
      text: content.text.body,
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
    content: WhatsappTextContent,
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
}
