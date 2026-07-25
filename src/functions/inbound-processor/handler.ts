import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { ProcessTelegramUpdate } from "../../application/telegram/process-telegram-update.js";
import { telegramInboundEnvelopeSchema } from "../../contracts/queues/telegram-inbound.contract.js";
import { dynamoDocumentClient } from "../../infrastructure/aws/clients.js";
import { DynamoTelegramMessageStore } from "../../infrastructure/dynamodb/dynamo-telegram-message-store.js";
import { loadInboundProcessorRuntimeConfig } from "../../shared/config/inbound-processor-runtime-config.js";

const logger = new Logger({
  serviceName: "inbound-processor",
});

export interface InboundProcessorHandlerDependencies {
  processTelegramUpdate: Pick<ProcessTelegramUpdate, "execute">;
}

export const createInboundProcessorHandler =
  ({ processTelegramUpdate }: InboundProcessorHandlerDependencies) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        const envelope = telegramInboundEnvelopeSchema.parse(JSON.parse(record.body) as unknown);
        await processTelegramUpdate.execute(envelope);
      } catch (error) {
        logger.error("Failed to process an inbound provider event.", {
          error,
          messageId: record.messageId,
        });
        batchItemFailures.push({
          itemIdentifier: record.messageId,
        });
      }
    }

    return {
      batchItemFailures,
    };
  };

const config = loadInboundProcessorRuntimeConfig();
const messageStore = new DynamoTelegramMessageStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);

export const main = createInboundProcessorHandler({
  processTelegramUpdate: new ProcessTelegramUpdate(messageStore),
});
