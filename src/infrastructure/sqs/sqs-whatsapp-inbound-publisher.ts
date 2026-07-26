import { createHash } from "node:crypto";

import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { ulid } from "ulid";

import type {
  WhatsappInboundEvent,
  WhatsappInboundPublisher,
} from "../../application/ports/whatsapp-inbound-publisher.js";
import type { WhatsappInboundEnvelope } from "../../contracts/queues/whatsapp-inbound.contract.js";

export class SqsWhatsappInboundPublisher implements WhatsappInboundPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async publish(event: WhatsappInboundEvent): Promise<void> {
    const eventId = `evt_${ulid()}`;
    const providerEventKey =
      event.kind === "MESSAGE"
        ? `MESSAGE:${event.message.id}`
        : `STATUS:${event.status.id}:${event.status.status}:${event.status.timestamp}`;
    const groupRecipient =
      event.kind === "MESSAGE" ? event.message.from : event.status.recipient_id;
    const envelope: WhatsappInboundEnvelope =
      event.kind === "MESSAGE"
        ? {
            applicationId: event.applicationId,
            correlationId: event.correlationId,
            eventId,
            eventType: "whatsapp.message.received",
            integrationId: event.integrationId,
            occurredAt: event.receivedAt,
            payload: {
              ...(event.contact === undefined ? {} : { contact: event.contact }),
              kind: "MESSAGE",
              message: event.message,
              phoneNumberId: event.phoneNumberId,
            },
            schemaVersion: 1,
            tenantId: event.tenantId,
          }
        : {
            applicationId: event.applicationId,
            correlationId: event.correlationId,
            eventId,
            eventType: "whatsapp.message.status",
            integrationId: event.integrationId,
            occurredAt: event.receivedAt,
            payload: {
              kind: "STATUS",
              phoneNumberId: event.phoneNumberId,
              status: event.status,
            },
            schemaVersion: 1,
            tenantId: event.tenantId,
          };

    await this.#client.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(envelope),
        MessageDeduplicationId: createHash("sha256")
          .update(`WHATSAPP:${event.integrationId}:${providerEventKey}`, "utf8")
          .digest("hex"),
        MessageGroupId: `${event.integrationId}:${groupRecipient}`,
        QueueUrl: this.#queueUrl,
      }),
    );
  }
}
