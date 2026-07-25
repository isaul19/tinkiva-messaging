import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { SendTelegramMessage } from "../../application/telegram/send-telegram-message.js";
import { telegramOutboundEnvelopeSchema } from "../../contracts/queues/telegram-outbound.contract.js";
import { dynamoDocumentClient, secretsManagerClient } from "../../infrastructure/aws/clients.js";
import { DynamoTelegramSendStore } from "../../infrastructure/dynamodb/dynamo-telegram-send-store.js";
import { CachedSecretReader } from "../../infrastructure/secrets/cached-secret-reader.js";
import { TelegramMessageApiClient } from "../../infrastructure/telegram/telegram-message-api-client.js";
import { loadTelegramSenderRuntimeConfig } from "../../shared/config/telegram-sender-runtime-config.js";

const logger = new Logger({
  serviceName: "telegram-sender",
});

export interface TelegramSenderHandlerDependencies {
  sendTelegramMessage: Pick<SendTelegramMessage, "execute">;
}

export const createTelegramSenderHandler =
  ({ sendTelegramMessage }: TelegramSenderHandlerDependencies) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        const envelope = telegramOutboundEnvelopeSchema.parse(JSON.parse(record.body) as unknown);
        await sendTelegramMessage.execute(envelope);
      } catch (error) {
        logger.error("Telegram outbound record failed.", {
          error,
          messageId: record.messageId,
        });
        batchItemFailures.push({
          itemIdentifier: record.messageId,
        });
      }
    }

    return { batchItemFailures };
  };

const config = loadTelegramSenderRuntimeConfig();
const store = new DynamoTelegramSendStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);

export const main = createTelegramSenderHandler({
  sendTelegramMessage: new SendTelegramMessage(
    store,
    new CachedSecretReader(secretsManagerClient),
    new TelegramMessageApiClient(),
  ),
});
