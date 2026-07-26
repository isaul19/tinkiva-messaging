import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

import type { WhatsappOutboundPublisher } from "../../application/ports/whatsapp-outbound-publisher.js";
import type { WhatsappOutboundEnvelope } from "../../contracts/queues/whatsapp-outbound.contract.js";

export class SqsWhatsappOutboundPublisher implements WhatsappOutboundPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async publish(envelope: WhatsappOutboundEnvelope): Promise<void> {
    const integrationId = envelope.integrationId;

    if (integrationId === undefined) {
      throw new Error("WhatsApp outbound envelope is missing integrationId.");
    }

    await this.#client.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(envelope),
        MessageDeduplicationId: envelope.payload.messageId,
        MessageGroupId: `${integrationId}:${envelope.payload.recipientId}`,
        QueueUrl: this.#queueUrl,
      }),
    );
  }
}
