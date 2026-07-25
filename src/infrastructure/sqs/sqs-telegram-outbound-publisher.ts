import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

import type { TelegramOutboundPublisher } from "../../application/ports/telegram-outbound-publisher.js";
import type { TelegramOutboundEnvelope } from "../../contracts/queues/telegram-outbound.contract.js";

export class SqsTelegramOutboundPublisher implements TelegramOutboundPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async publish(envelope: TelegramOutboundEnvelope): Promise<void> {
    const integrationId = envelope.integrationId;

    if (integrationId === undefined) {
      throw new Error("Telegram outbound envelope is missing integrationId.");
    }

    await this.#client.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(envelope),
        MessageDeduplicationId: envelope.payload.messageId,
        MessageGroupId: `${integrationId}:${envelope.payload.chatId}`,
        QueueUrl: this.#queueUrl,
      }),
    );
  }
}
