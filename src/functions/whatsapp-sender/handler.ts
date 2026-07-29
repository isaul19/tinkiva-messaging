import { Logger } from "@aws-lambda-powertools/logger";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

import { SendWhatsappMessage } from "../../application/whatsapp/send-whatsapp-message.js";
import { whatsappOutboundEnvelopeSchema } from "../../contracts/queues/whatsapp-outbound.contract.js";
import { dynamoDocumentClient, kmsClient, s3Client } from "../../infrastructure/aws/clients.js";
import { KmsDynamoWhatsappCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-whatsapp-credential-vault.js";
import { DynamoWhatsappSendStore } from "../../infrastructure/dynamodb/dynamo-whatsapp-send-store.js";
import { S3MediaStore } from "../../infrastructure/s3/s3-media-store.js";
import { WhatsappMessageApiClient } from "../../infrastructure/whatsapp/whatsapp-message-api-client.js";
import { loadWhatsappSenderRuntimeConfig } from "../../shared/config/whatsapp-sender-runtime-config.js";

const logger = new Logger({
  serviceName: "whatsapp-sender",
});

export interface WhatsappSenderHandlerDependencies {
  sendWhatsappMessage: Pick<SendWhatsappMessage, "execute">;
}

export const createWhatsappSenderHandler =
  ({ sendWhatsappMessage }: WhatsappSenderHandlerDependencies) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        const envelope = whatsappOutboundEnvelopeSchema.parse(JSON.parse(record.body) as unknown);
        await sendWhatsappMessage.execute(envelope);
      } catch (error) {
        logger.error("Failed to send a WhatsApp message.", {
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

const config = loadWhatsappSenderRuntimeConfig();
const store = new DynamoWhatsappSendStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);
const credentialVault = new KmsDynamoWhatsappCredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});
const mediaStore = new S3MediaStore(s3Client, {
  bucket: config.MEDIA_BUCKET,
  urlTtlSeconds: config.MEDIA_URL_TTL_SECONDS,
});

export const main = createWhatsappSenderHandler({
  sendWhatsappMessage: new SendWhatsappMessage(
    store,
    credentialVault,
    new WhatsappMessageApiClient(),
    mediaStore,
  ),
});
