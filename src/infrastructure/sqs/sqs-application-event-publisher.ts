import { createHash } from "node:crypto";

import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

import type { ApplicationEventPublisher } from "../../application/ports/application-event-publisher.js";
import {
  realtimeMessageEventSchema,
  type RealtimeMessageEvent,
} from "../../contracts/api/realtime.contract.js";

export class SqsApplicationEventPublisher implements ApplicationEventPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async publish(event: RealtimeMessageEvent): Promise<void> {
    const validated = realtimeMessageEventSchema.parse(event);

    await this.#client.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(validated),
        MessageDeduplicationId: sha256(validated.eventId),
        MessageGroupId: `${validated.applicationId}:${validated.tenantId}:${validated.data.conversationId}`,
        QueueUrl: this.#queueUrl,
      }),
    );
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
