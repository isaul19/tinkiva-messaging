import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { ReceiveTelegramUpdate } from "../../application/telegram/receive-telegram-update.js";
import { telegramUpdateSchema } from "../../contracts/providers/telegram.contract.js";
import { dynamoDocumentClient, kmsClient } from "../../infrastructure/aws/clients.js";
import { DynamoTelegramIntegrationReader } from "../../infrastructure/dynamodb/dynamo-telegram-integration-reader.js";
import { KmsDynamoTelegramCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-telegram-credential-vault.js";
import { SqsTelegramInboundPublisher } from "../../infrastructure/sqs/sqs-telegram-inbound-publisher.js";
import { loadTelegramWebhookRuntimeConfig } from "../../shared/config/telegram-webhook-runtime-config.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { errorResponse } from "../../shared/http/error-response.js";
import { jsonResponse } from "../../shared/http/json-response.js";
import { readHeader, readJsonBody } from "../../shared/http/request-body.js";

const logger = new Logger({
  serviceName: "telegram-webhook",
});

export interface TelegramWebhookHandlerDependencies {
  receiveTelegramUpdate: Pick<ReceiveTelegramUpdate, "execute">;
}

export const createTelegramWebhookHandler =
  ({ receiveTelegramUpdate }: TelegramWebhookHandlerDependencies) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const correlationId = resolveCorrelationId(event.headers);

    try {
      const webhookKey = z.string().min(32).max(200).parse(event.pathParameters?.webhookKey);
      const update = telegramUpdateSchema.parse(readJsonBody(event));
      const result = await receiveTelegramUpdate.execute({
        correlationId,
        secretToken: readHeader(event.headers, "X-Telegram-Bot-Api-Secret-Token"),
        update,
        webhookKey,
      });

      return jsonResponse(202, result, correlationId);
    } catch (error) {
      if (!(error instanceof ApplicationError) && !(error instanceof z.ZodError)) {
        logger.error("Unhandled Telegram webhook error.", {
          correlationId,
          error,
        });
      }

      return errorResponse(error, correlationId);
    }
  };

const config = loadTelegramWebhookRuntimeConfig();
const integrationReader = new DynamoTelegramIntegrationReader(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const credentialVault = new KmsDynamoTelegramCredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});
const publisher = new SqsTelegramInboundPublisher(new SQSClient({}), config.INBOUND_QUEUE_URL);

export const main = createTelegramWebhookHandler({
  receiveTelegramUpdate: new ReceiveTelegramUpdate(integrationReader, credentialVault, publisher),
});
