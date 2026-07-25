import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { QueueTelegramMessage } from "../../application/messages/queue-telegram-message.js";
import { RegisterTelegramIntegration } from "../../application/telegram/register-telegram-integration.js";
import { EnsureTenant } from "../../application/tenants/ensure-tenant.js";
import { GetTenant } from "../../application/tenants/get-tenant.js";
import type { ApplicationScope } from "../../contracts/api/auth.contract.js";
import { registerTelegramIntegrationRequestSchema } from "../../contracts/api/integration.contract.js";
import { sendMessageRequestSchema } from "../../contracts/api/message.contract.js";
import { ensureTenantRequestSchema } from "../../contracts/api/tenant.contract.js";
import { tenantIdSchema } from "../../contracts/shared/identifiers.js";
import { dynamoDocumentClient, kmsClient } from "../../infrastructure/aws/clients.js";
import { DynamoOutgoingMessageStore } from "../../infrastructure/dynamodb/dynamo-outgoing-message-store.js";
import { KmsDynamoTelegramCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-telegram-credential-vault.js";
import { DynamoTelegramIntegrationStore } from "../../infrastructure/dynamodb/dynamo-telegram-integration-store.js";
import { DynamoTenantStore } from "../../infrastructure/dynamodb/dynamo-tenant-store.js";
import { SqsTelegramOutboundPublisher } from "../../infrastructure/sqs/sqs-telegram-outbound-publisher.js";
import { TelegramBotApiClient } from "../../infrastructure/telegram/telegram-bot-api-client.js";
import { loadPrivateApiRuntimeConfig } from "../../shared/config/private-api-runtime-config.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { errorResponse } from "../../shared/http/error-response.js";
import { jsonResponse } from "../../shared/http/json-response.js";
import { readHeader, readJsonBody } from "../../shared/http/request-body.js";

type PrivateApiEvent = APIGatewayProxyEventV2 & {
  requestContext: APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: {
      lambda?: unknown;
    };
  };
};

const authorizerContextSchema = z.strictObject({
  applicationId: z.string().min(1),
  clientId: z.string().min(1),
  scope: z.string(),
});

const logger = new Logger({
  serviceName: "private-api",
});

export interface PrivateApiHandlerDependencies {
  ensureTenant: Pick<EnsureTenant, "execute">;
  getTenant: Pick<GetTenant, "byExternalAccount" | "byTenantId">;
  queueTelegramMessage: Pick<QueueTelegramMessage, "execute">;
  registerTelegramIntegration: Pick<RegisterTelegramIntegration, "execute">;
}

export const createPrivateApiHandler =
  ({
    ensureTenant,
    getTenant,
    queueTelegramMessage,
    registerTelegramIntegration,
  }: PrivateApiHandlerDependencies) =>
  async (event: PrivateApiEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    const correlationId = resolveCorrelationId(event.headers);

    try {
      const identity = authorizerContextSchema.parse(event.requestContext.authorizer?.lambda);

      if (event.routeKey === "POST /v1/tenants") {
        requireScope(identity.scope, "tenants:write");
        const idempotencyKey = requireIdempotencyKey(event.headers);
        const request = ensureTenantRequestSchema.parse(readJsonBody(event));
        const result = await ensureTenant.execute({
          applicationId: identity.applicationId,
          idempotencyKey,
          request,
        });

        return jsonResponse(
          result.created ? 201 : 200,
          {
            externalAccountId: result.externalAccountId,
            status: result.status,
            tenantId: result.tenantId,
          },
          correlationId,
        );
      }

      if (event.routeKey === "POST /v1/messages") {
        requireScope(identity.scope, "messages:send");
        const idempotencyKey = requireIdempotencyKey(event.headers);
        const request = sendMessageRequestSchema.parse(readJsonBody(event));
        await getTenant.byTenantId(identity.applicationId, request.tenantId);
        const result = await queueTelegramMessage.execute({
          applicationId: identity.applicationId,
          correlationId,
          idempotencyKey,
          request,
        });

        return jsonResponse(202, result, correlationId);
      }

      if (event.routeKey === "POST /v1/tenants/{tenantId}/integrations/telegram") {
        requireScope(identity.scope, "integrations:write");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const request = registerTelegramIntegrationRequestSchema.parse(readJsonBody(event));
        const integration = await registerTelegramIntegration.execute({
          applicationId: identity.applicationId,
          request,
          tenantId,
        });

        return jsonResponse(201, integration, correlationId);
      }

      if (event.routeKey === "GET /v1/tenants/by-external-account/{externalAccountId}") {
        requireScope(identity.scope, "tenants:read");
        const externalAccountId = z
          .string()
          .min(1)
          .max(255)
          .parse(event.pathParameters?.externalAccountId);
        const tenant = await getTenant.byExternalAccount(identity.applicationId, externalAccountId);

        return jsonResponse(200, tenant, correlationId);
      }

      if (event.routeKey === "GET /v1/tenants/{tenantId}") {
        requireScope(identity.scope, "tenants:read");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const tenant = await getTenant.byTenantId(identity.applicationId, tenantId);

        return jsonResponse(200, tenant, correlationId);
      }

      throw new ApplicationError("TENANT_NOT_FOUND", "The requested route does not exist.", 404);
    } catch (error) {
      if (!(error instanceof ApplicationError) && !(error instanceof z.ZodError)) {
        logger.error("Unhandled private API error.", {
          correlationId,
          error,
          routeKey: event.routeKey,
        });
      }

      return errorResponse(error, correlationId);
    }
  };

const requireScope = (scope: string, requiredScope: ApplicationScope): void => {
  if (!scope.split(" ").includes(requiredScope)) {
    throw new ApplicationError(
      "AUTH_SCOPE_MISSING",
      "The access token does not grant the required scope.",
      403,
    );
  }
};

const requireIdempotencyKey = (headers: Record<string, string | undefined>): string => {
  const idempotencyKey = readHeader(headers, "Idempotency-Key")?.trim();

  if (idempotencyKey === undefined || idempotencyKey.length === 0 || idempotencyKey.length > 255) {
    throw new ApplicationError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
      400,
    );
  }

  return idempotencyKey;
};

const config = loadPrivateApiRuntimeConfig();
const tenantStore = new DynamoTenantStore(dynamoDocumentClient, config.CONTROL_TABLE);
const telegramIntegrationStore = new DynamoTelegramIntegrationStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const outgoingMessageStore = new DynamoOutgoingMessageStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);
const credentialVault = new KmsDynamoTelegramCredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});

export const main = createPrivateApiHandler({
  ensureTenant: new EnsureTenant(tenantStore),
  getTenant: new GetTenant(tenantStore),
  queueTelegramMessage: new QueueTelegramMessage(
    outgoingMessageStore,
    new SqsTelegramOutboundPublisher(new SQSClient({}), config.TELEGRAM_OUTBOUND_QUEUE_URL),
  ),
  registerTelegramIntegration: new RegisterTelegramIntegration(
    new TelegramBotApiClient(),
    credentialVault,
    telegramIntegrationStore,
    {
      webhookBaseUrl: config.TELEGRAM_WEBHOOK_BASE_URL,
    },
  ),
});
