import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { ProcessTelegramUpdate } from "../../application/telegram/process-telegram-update.js";
import { ProcessWhatsappEvent } from "../../application/whatsapp/process-whatsapp-event.js";
import { telegramInboundEnvelopeSchema } from "../../contracts/queues/telegram-inbound.contract.js";
import {
  whatsappInboundMessageEnvelopeSchema,
  whatsappInboundStatusEnvelopeSchema,
} from "../../contracts/queues/whatsapp-inbound.contract.js";
import { dynamoDocumentClient } from "../../infrastructure/aws/clients.js";
import { DynamoTelegramMessageStore } from "../../infrastructure/dynamodb/dynamo-telegram-message-store.js";
import { DynamoWhatsappMessageStore } from "../../infrastructure/dynamodb/dynamo-whatsapp-message-store.js";
import { loadInboundProcessorRuntimeConfig } from "../../shared/config/inbound-processor-runtime-config.js";

const logger = new Logger({
  serviceName: "inbound-processor",
});

export interface InboundProcessorHandlerDependencies {
  processTelegramUpdate: Pick<ProcessTelegramUpdate, "execute">;
  processWhatsappEvent: Pick<ProcessWhatsappEvent, "processMessage" | "processStatus">;
}

export const createInboundProcessorHandler =
  ({ processTelegramUpdate, processWhatsappEvent }: InboundProcessorHandlerDependencies) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        const body: unknown = JSON.parse(record.body);
        const eventType =
          typeof body === "object" &&
          body !== null &&
          "eventType" in body &&
          typeof body.eventType === "string"
            ? body.eventType
            : undefined;

        if (eventType === "telegram.update.received") {
          await processTelegramUpdate.execute(telegramInboundEnvelopeSchema.parse(body));
        } else if (eventType === "whatsapp.message.received") {
          await processWhatsappEvent.processMessage(
            whatsappInboundMessageEnvelopeSchema.parse(body),
          );
        } else if (eventType === "whatsapp.message.status") {
          await processWhatsappEvent.processStatus(whatsappInboundStatusEnvelopeSchema.parse(body));
        } else {
          throw new Error("Unsupported inbound provider event type.");
        }
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
const telegramMessageStore = new DynamoTelegramMessageStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);
const whatsappMessageStore = new DynamoWhatsappMessageStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);

export const main = createInboundProcessorHandler({
  processTelegramUpdate: new ProcessTelegramUpdate(telegramMessageStore),
  processWhatsappEvent: new ProcessWhatsappEvent(whatsappMessageStore),
});
