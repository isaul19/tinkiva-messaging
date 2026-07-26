import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { ReceiveWhatsappWebhook } from "../../application/whatsapp/receive-whatsapp-webhook.js";
import { whatsappWebhookPayloadSchema } from "../../contracts/providers/whatsapp.contract.js";
import { dynamoDocumentClient, kmsClient } from "../../infrastructure/aws/clients.js";
import { DynamoWhatsappIntegrationReader } from "../../infrastructure/dynamodb/dynamo-whatsapp-integration-reader.js";
import { KmsDynamoWhatsappCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-whatsapp-credential-vault.js";
import { SqsWhatsappInboundPublisher } from "../../infrastructure/sqs/sqs-whatsapp-inbound-publisher.js";
import { loadWhatsappWebhookRuntimeConfig } from "../../shared/config/whatsapp-webhook-runtime-config.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { errorResponse } from "../../shared/http/error-response.js";
import { jsonResponse } from "../../shared/http/json-response.js";
import { readHeader, readJsonBody } from "../../shared/http/request-body.js";

const logger = new Logger({
  serviceName: "whatsapp-webhook",
});

export interface WhatsappWebhookHandlerDependencies {
  receiveWhatsappWebhook: Pick<ReceiveWhatsappWebhook, "receive" | "verifyChallenge">;
}

export const createWhatsappWebhookHandler =
  ({ receiveWhatsappWebhook }: WhatsappWebhookHandlerDependencies) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const correlationId = resolveCorrelationId(event.headers);

    try {
      const webhookKey = z.string().min(32).max(200).parse(event.pathParameters?.webhookKey);

      if (event.requestContext.http.method === "GET") {
        const challenge = await receiveWhatsappWebhook.verifyChallenge({
          challenge: event.queryStringParameters?.["hub.challenge"],
          mode: event.queryStringParameters?.["hub.mode"],
          verifyToken: event.queryStringParameters?.["hub.verify_token"],
          webhookKey,
        });

        return {
          body: challenge,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-content-type-options": "nosniff",
            "x-correlation-id": correlationId,
          },
          isBase64Encoded: false,
          statusCode: 200,
        };
      }

      if (event.requestContext.http.method !== "POST") {
        throw new ApplicationError(
          "WEBHOOK_NOT_FOUND",
          "The requested webhook does not exist.",
          404,
        );
      }

      const rawBody = readRawBody(event);
      const payload = whatsappWebhookPayloadSchema.parse(readJsonBody(event));
      const result = await receiveWhatsappWebhook.receive({
        correlationId,
        payload,
        rawBody,
        signature: readHeader(event.headers, "X-Hub-Signature-256"),
        webhookKey,
      });

      return jsonResponse(200, result, correlationId);
    } catch (error) {
      if (!(error instanceof ApplicationError) && !(error instanceof z.ZodError)) {
        logger.error("Unhandled WhatsApp webhook error.", {
          correlationId,
          error,
        });
      }

      return errorResponse(error, correlationId);
    }
  };

const readRawBody = (event: APIGatewayProxyEventV2): Buffer => {
  if (event.body === undefined) {
    throw new ApplicationError("VALIDATION_ERROR", "A JSON request body is required.", 400);
  }

  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
};

const config = loadWhatsappWebhookRuntimeConfig();
const integrationReader = new DynamoWhatsappIntegrationReader(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const credentialVault = new KmsDynamoWhatsappCredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});
const publisher = new SqsWhatsappInboundPublisher(new SQSClient({}), config.INBOUND_QUEUE_URL);

export const main = createWhatsappWebhookHandler({
  receiveWhatsappWebhook: new ReceiveWhatsappWebhook(integrationReader, credentialVault, publisher),
});
