import { createHash } from "node:crypto";

import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { ulid } from "ulid";

import type {
  TelegramInboundEvent,
  TelegramInboundPublisher,
} from "../../application/ports/telegram-inbound-publisher.js";

export class SqsTelegramInboundPublisher implements TelegramInboundPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async publish(event: TelegramInboundEvent): Promise<void> {
    const eventId = `evt_${ulid()}`;
    const deduplicationId = createHash("sha256")
      .update(`TELEGRAM:${event.integrationId}:${String(event.update.update_id)}`, "utf8")
      .digest("hex");

    await this.#client.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify({
          applicationId: event.applicationId,
          correlationId: event.correlationId,
          eventId,
          eventType: "telegram.update.received",
          integrationId: event.integrationId,
          occurredAt: event.receivedAt,
          payload: {
            update: event.update,
          },
          schemaVersion: 1,
          tenantId: event.tenantId,
        }),
        MessageDeduplicationId: deduplicationId,
        MessageGroupId: `${event.integrationId}:${event.chatId}`,
        QueueUrl: this.#queueUrl,
      }),
    );
  }
}
