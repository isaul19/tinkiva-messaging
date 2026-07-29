import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { ProcessTelegramUpdate } from "../../application/telegram/process-telegram-update.js";
import { ProcessWhatsappEvent } from "../../application/whatsapp/process-whatsapp-event.js";
import { telegramInboundEnvelopeSchema } from "../../contracts/queues/telegram-inbound.contract.js";
import {
  whatsappInboundMessageEnvelopeSchema,
  whatsappInboundStatusEnvelopeSchema,
} from "../../contracts/queues/whatsapp-inbound.contract.js";
import { dynamoDocumentClient, kmsClient, s3Client } from "../../infrastructure/aws/clients.js";
import { KmsDynamoTelegramCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-telegram-credential-vault.js";
import { KmsDynamoWhatsappCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-whatsapp-credential-vault.js";
import { DynamoTelegramMessageStore } from "../../infrastructure/dynamodb/dynamo-telegram-message-store.js";
import { DynamoWhatsappMessageStore } from "../../infrastructure/dynamodb/dynamo-whatsapp-message-store.js";
import { ProviderInboundImageImporter } from "../../infrastructure/media/provider-inbound-image-importer.js";
import { S3MediaStore } from "../../infrastructure/s3/s3-media-store.js";
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
const telegramCredentials = new KmsDynamoTelegramCredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});
const whatsappCredentials = new KmsDynamoWhatsappCredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});
const mediaStore = new S3MediaStore(s3Client, {
  bucket: config.MEDIA_BUCKET,
  urlTtlSeconds: config.MEDIA_URL_TTL_SECONDS,
});
const inboundImageImporter = new ProviderInboundImageImporter(
  dynamoDocumentClient,
  telegramCredentials,
  whatsappCredentials,
  mediaStore,
  { controlTable: config.CONTROL_TABLE },
);

export const main = createInboundProcessorHandler({
  processTelegramUpdate: new ProcessTelegramUpdate(telegramMessageStore, inboundImageImporter),
  processWhatsappEvent: new ProcessWhatsappEvent(whatsappMessageStore, inboundImageImporter),
});
