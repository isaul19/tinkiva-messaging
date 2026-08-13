import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { DeleteConversation } from "../../application/conversations/delete-conversation.js";
import { ListConversationMessages } from "../../application/conversations/list-conversation-messages.js";
import { ListConversations } from "../../application/conversations/list-conversations.js";
import { ListTenantIntegrations } from "../../application/integrations/list-tenant-integrations.js";
import { QueueMessage } from "../../application/messages/queue-message.js";
import { QueueTelegramMessage } from "../../application/messages/queue-telegram-message.js";
import { QueueWhatsappMessage } from "../../application/messages/queue-whatsapp-message.js";
import { CreateRealtimeTicket } from "../../application/realtime/create-realtime-ticket.js";
import { RegisterTelegramIntegration } from "../../application/telegram/register-telegram-integration.js";
import { EnsureTenant } from "../../application/tenants/ensure-tenant.js";
import { GetTenant } from "../../application/tenants/get-tenant.js";
import { CompleteWhatsappEmbeddedSignup } from "../../application/whatsapp/complete-whatsapp-embedded-signup.js";
import { GetWhatsappEmbeddedSignupConfiguration } from "../../application/whatsapp/get-whatsapp-embedded-signup-configuration.js";
import { RegisterWhatsappIntegration } from "../../application/whatsapp/register-whatsapp-integration.js";
import { RotateWhatsappAccessToken } from "../../application/whatsapp/rotate-whatsapp-access-token.js";
import type { ApplicationScope } from "../../contracts/api/auth.contract.js";
import {
  conversationListQuerySchema,
  conversationMessageListQuerySchema,
} from "../../contracts/api/conversation.contract.js";
import { registerTelegramIntegrationRequestSchema } from "../../contracts/api/integration.contract.js";
import { sendMessageRequestSchema } from "../../contracts/api/message.contract.js";
import { updateInboundMediaSettingsRequestSchema } from "../../contracts/api/inbound-media.contract.js";
import { ensureTenantRequestSchema } from "../../contracts/api/tenant.contract.js";
import { completeWhatsappEmbeddedSignupRequestSchema } from "../../contracts/api/whatsapp-embedded-signup.contract.js";
import {
  registerWhatsappIntegrationRequestSchema,
  rotateWhatsappCredentialRequestSchema,
} from "../../contracts/api/whatsapp-integration.contract.js";
import {
  conversationIdSchema,
  integrationIdSchema,
  tenantIdSchema,
} from "../../contracts/shared/identifiers.js";
import { dynamoDocumentClient, kmsClient, s3Client } from "../../infrastructure/aws/clients.js";
import { DynamoConversationReader } from "../../infrastructure/dynamodb/dynamo-conversation-reader.js";
import { DynamoConversationStore } from "../../infrastructure/dynamodb/dynamo-conversation-store.js";
import { DynamoMessageIntegrationReader } from "../../infrastructure/dynamodb/dynamo-message-integration-reader.js";
import { DynamoPlatformAdminStore } from "../../infrastructure/dynamodb/dynamo-platform-admin-store.js";
import { DynamoOutgoingMessageStore } from "../../infrastructure/dynamodb/dynamo-outgoing-message-store.js";
import { DynamoRealtimeStore } from "../../infrastructure/dynamodb/dynamo-realtime-store.js";
import { KmsDynamoTelegramCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-telegram-credential-vault.js";
import { DynamoTelegramIntegrationStore } from "../../infrastructure/dynamodb/dynamo-telegram-integration-store.js";
import { DynamoTenantIntegrationReader } from "../../infrastructure/dynamodb/dynamo-tenant-integration-reader.js";
import { DynamoTenantStore } from "../../infrastructure/dynamodb/dynamo-tenant-store.js";
import { KmsDynamoWhatsappCredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-whatsapp-credential-vault.js";
import { KmsDynamoWhatsappEmbeddedSignupConfiguration } from "../../infrastructure/dynamodb/kms-dynamo-whatsapp-embedded-signup-configuration.js";
import { DynamoWhatsappIntegrationAdminReader } from "../../infrastructure/dynamodb/dynamo-whatsapp-integration-admin-reader.js";
import { DynamoWhatsappIntegrationStore } from "../../infrastructure/dynamodb/dynamo-whatsapp-integration-store.js";
import { DynamoWhatsappOutgoingMessageStore } from "../../infrastructure/dynamodb/dynamo-whatsapp-outgoing-message-store.js";
import { SqsTelegramOutboundPublisher } from "../../infrastructure/sqs/sqs-telegram-outbound-publisher.js";
import { SqsWhatsappOutboundPublisher } from "../../infrastructure/sqs/sqs-whatsapp-outbound-publisher.js";
import { S3MediaStore } from "../../infrastructure/s3/s3-media-store.js";
import { TelegramBotApiClient } from "../../infrastructure/telegram/telegram-bot-api-client.js";
import { WhatsappManagementApiClient } from "../../infrastructure/whatsapp/whatsapp-management-api-client.js";
import { loadPrivateApiRuntimeConfig } from "../../shared/config/private-api-runtime-config.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { errorResponse } from "../../shared/http/error-response.js";
import { jsonResponse, noContentResponse } from "../../shared/http/json-response.js";
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
  completeWhatsappEmbeddedSignup: Pick<CompleteWhatsappEmbeddedSignup, "execute">;
  createRealtimeTicket: Pick<CreateRealtimeTicket, "execute">;
  deleteConversation: Pick<DeleteConversation, "execute">;
  ensureTenant: Pick<EnsureTenant, "execute">;
  getTenant: Pick<GetTenant, "byExternalAccount" | "byTenantId">;
  getWhatsappEmbeddedSignupConfiguration: Pick<GetWhatsappEmbeddedSignupConfiguration, "execute">;
  listConversationMessages: Pick<ListConversationMessages, "execute">;
  listConversations: Pick<ListConversations, "execute">;
  listTenantIntegrations: Pick<ListTenantIntegrations, "execute">;
  updateInboundMedia: Pick<DynamoPlatformAdminStore, "updateInboundMedia">;
  queueMessage: Pick<QueueMessage, "execute">;
  registerTelegramIntegration: Pick<RegisterTelegramIntegration, "execute">;
  registerWhatsappIntegration: Pick<RegisterWhatsappIntegration, "execute">;
  rotateWhatsappAccessToken: Pick<RotateWhatsappAccessToken, "execute">;
}

export const createPrivateApiHandler =
  ({
    completeWhatsappEmbeddedSignup,
    createRealtimeTicket,
    deleteConversation,
    ensureTenant,
    getWhatsappEmbeddedSignupConfiguration,
    getTenant,
    listConversationMessages,
    listConversations,
    listTenantIntegrations,
    updateInboundMedia,
    queueMessage,
    registerTelegramIntegration,
    registerWhatsappIntegration,
    rotateWhatsappAccessToken,
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

      if (event.routeKey === "GET /v1/tenants/{tenantId}/conversations") {
        requireScope(identity.scope, "messages:read");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const query = conversationListQuerySchema.parse(event.queryStringParameters ?? {});
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const result = await listConversations.execute({
          applicationId: identity.applicationId,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          integrationId: query.integrationId,
          limit: query.limit,
          tenantId,
        });

        return jsonResponse(200, result, correlationId);
      }

      if (event.routeKey === "GET /v1/tenants/{tenantId}/conversations/{conversationId}/messages") {
        requireScope(identity.scope, "messages:read");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const conversationId = conversationIdSchema.parse(event.pathParameters?.conversationId);
        const query = conversationMessageListQuerySchema.parse(event.queryStringParameters ?? {});
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const result = await listConversationMessages.execute({
          applicationId: identity.applicationId,
          conversationId,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          limit: query.limit,
          tenantId,
        });

        return jsonResponse(200, result, correlationId);
      }

      if (event.routeKey === "DELETE /v1/tenants/{tenantId}/conversations/{conversationId}") {
        requireScope(identity.scope, "messages:send");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const conversationId = conversationIdSchema.parse(event.pathParameters?.conversationId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        await deleteConversation.execute({
          applicationId: identity.applicationId,
          conversationId,
          tenantId,
        });

        return noContentResponse(correlationId);
      }

      if (event.routeKey === "POST /v1/tenants/{tenantId}/realtime/tickets") {
        requireScope(identity.scope, "messages:read");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const result = await createRealtimeTicket.execute({
          applicationId: identity.applicationId,
          tenantId,
        });

        return jsonResponse(201, result, correlationId);
      }

      if (event.routeKey === "POST /v1/messages") {
        requireScope(identity.scope, "messages:send");
        const idempotencyKey = requireIdempotencyKey(event.headers);
        const request = sendMessageRequestSchema.parse(readJsonBody(event));
        await getTenant.byTenantId(identity.applicationId, request.tenantId);
        const result = await queueMessage.execute({
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

      if (event.routeKey === "POST /v1/tenants/{tenantId}/integrations/whatsapp") {
        requireScope(identity.scope, "integrations:write");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const request = registerWhatsappIntegrationRequestSchema.parse(readJsonBody(event));
        const integration = await registerWhatsappIntegration.execute({
          applicationId: identity.applicationId,
          request,
          tenantId,
        });

        return jsonResponse(201, integration, correlationId);
      }

      if (
        event.routeKey === "PATCH /v1/tenants/{tenantId}/integrations/{integrationId}/inbound-media"
      ) {
        requireScope(identity.scope, "integrations:write");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const integrationId = integrationIdSchema.parse(event.pathParameters?.integrationId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const inboundMedia = updateInboundMediaSettingsRequestSchema.parse(readJsonBody(event));
        const result = await updateInboundMedia.updateInboundMedia({
          applicationId: identity.applicationId,
          inboundMedia,
          integrationId,
          tenantId,
        });

        return jsonResponse(200, { integrationId, ...result }, correlationId);
      }

      if (
        event.routeKey === "GET /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup/config"
      ) {
        requireScope(identity.scope, "integrations:write");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const result = await getWhatsappEmbeddedSignupConfiguration.execute();

        return jsonResponse(200, result, correlationId);
      }

      if (event.routeKey === "POST /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup") {
        requireScope(identity.scope, "integrations:write");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const request = completeWhatsappEmbeddedSignupRequestSchema.parse(readJsonBody(event));
        const result = await completeWhatsappEmbeddedSignup.execute({
          applicationId: identity.applicationId,
          request,
          tenantId,
        });

        return jsonResponse(201, result, correlationId);
      }

      if (
        event.routeKey ===
        "PUT /v1/tenants/{tenantId}/integrations/whatsapp/{integrationId}/credentials"
      ) {
        requireScope(identity.scope, "integrations:write");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const integrationId = integrationIdSchema.parse(event.pathParameters?.integrationId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const request = rotateWhatsappCredentialRequestSchema.parse(readJsonBody(event));
        const result = await rotateWhatsappAccessToken.execute({
          applicationId: identity.applicationId,
          integrationId,
          request,
          tenantId,
        });

        return jsonResponse(200, result, correlationId);
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

      if (event.routeKey === "GET /v1/tenants/{tenantId}/integrations") {
        requireScope(identity.scope, "integrations:read");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        await getTenant.byTenantId(identity.applicationId, tenantId);
        const result = await listTenantIntegrations.execute({
          applicationId: identity.applicationId,
          tenantId,
        });

        return jsonResponse(200, result, correlationId);
      }

      if (event.routeKey === "GET /v1/tenants/{tenantId}") {
        requireScope(identity.scope, "tenants:read");
        const tenantId = tenantIdSchema.parse(event.pathParameters?.tenantId);
        const tenant = await getTenant.byTenantId(identity.applicationId, tenantId);

        return jsonResponse(200, tenant, correlationId);
      }

      throw new ApplicationError("TENANT_NOT_FOUND", "The requested route does not exist.", 404);
    } catch (error) {
      if (error instanceof ApplicationError) {
        logger.warn("Private API request rejected.", {
          code: error.code,
          correlationId,
          routeKey: event.routeKey,
          statusCode: error.statusCode,
        });
      } else if (!(error instanceof z.ZodError)) {
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
const sqsClient = new SQSClient({});
const tenantStore = new DynamoTenantStore(dynamoDocumentClient, config.CONTROL_TABLE);
const tenantIntegrationReader = new DynamoTenantIntegrationReader(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const telegramIntegrationStore = new DynamoTelegramIntegrationStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const whatsappIntegrationStore = new DynamoWhatsappIntegrationStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const realtimeStore = new DynamoRealtimeStore(dynamoDocumentClient, config.CONTROL_TABLE);
const whatsappEmbeddedSignupConfiguration = new KmsDynamoWhatsappEmbeddedSignupConfiguration(
  dynamoDocumentClient,
  kmsClient,
  {
    keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
    stage: config.STAGE,
    tableName: config.CONTROL_TABLE,
  },
);
const whatsappIntegrationAdminReader = new DynamoWhatsappIntegrationAdminReader(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
);
const mediaStore = new S3MediaStore(s3Client, {
  bucket: config.MEDIA_BUCKET,
  urlTtlSeconds: config.MEDIA_URL_TTL_SECONDS,
});
const inboundMediaSettings = new DynamoPlatformAdminStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
  mediaStore,
  config.TINKIVA_INTEGRATIONS_TABLE,
);
const conversationReader = new DynamoConversationReader(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
  mediaStore,
);
const conversationStore = new DynamoConversationStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
  mediaStore,
);
const outgoingMessageStore = new DynamoOutgoingMessageStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);
const whatsappOutgoingMessageStore = new DynamoWhatsappOutgoingMessageStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
);
const telegramCredentialVault = new KmsDynamoTelegramCredentialVault(
  dynamoDocumentClient,
  kmsClient,
  {
    keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
    stage: config.STAGE,
    tableName: config.CONTROL_TABLE,
  },
);
const whatsappCredentialVault = new KmsDynamoWhatsappCredentialVault(
  dynamoDocumentClient,
  kmsClient,
  {
    keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
    stage: config.STAGE,
    tableName: config.CONTROL_TABLE,
  },
);
const whatsappManagementApi = new WhatsappManagementApiClient();
const registerWhatsappIntegration = new RegisterWhatsappIntegration(
  whatsappManagementApi,
  whatsappCredentialVault,
  whatsappIntegrationStore,
  {
    graphApiVersion: config.WHATSAPP_GRAPH_API_VERSION,
    webhookBaseUrl: config.WHATSAPP_WEBHOOK_BASE_URL,
  },
);
const queueTelegramMessage = new QueueTelegramMessage(
  outgoingMessageStore,
  new SqsTelegramOutboundPublisher(sqsClient, config.TELEGRAM_OUTBOUND_QUEUE_URL),
  mediaStore,
);
const queueWhatsappMessage = new QueueWhatsappMessage(
  whatsappOutgoingMessageStore,
  new SqsWhatsappOutboundPublisher(sqsClient, config.WHATSAPP_OUTBOUND_QUEUE_URL),
  mediaStore,
);

export const main = createPrivateApiHandler({
  completeWhatsappEmbeddedSignup: new CompleteWhatsappEmbeddedSignup(
    whatsappEmbeddedSignupConfiguration,
    whatsappManagementApi,
    whatsappManagementApi,
    registerWhatsappIntegration,
    {
      graphApiVersion: config.WHATSAPP_GRAPH_API_VERSION,
    },
  ),
  createRealtimeTicket: new CreateRealtimeTicket(realtimeStore, {
    ttlSeconds: config.REALTIME_TICKET_TTL_SECONDS,
    websocketUrl: config.REALTIME_WEBSOCKET_URL,
  }),
  deleteConversation: new DeleteConversation(conversationStore),
  ensureTenant: new EnsureTenant(tenantStore),
  getTenant: new GetTenant(tenantStore),
  getWhatsappEmbeddedSignupConfiguration: new GetWhatsappEmbeddedSignupConfiguration(
    whatsappEmbeddedSignupConfiguration,
    {
      graphApiVersion: config.WHATSAPP_GRAPH_API_VERSION,
    },
  ),
  listConversationMessages: new ListConversationMessages(conversationReader),
  listConversations: new ListConversations(conversationReader),
  listTenantIntegrations: new ListTenantIntegrations(tenantIntegrationReader),
  updateInboundMedia: inboundMediaSettings,
  queueMessage: new QueueMessage(
    new DynamoMessageIntegrationReader(dynamoDocumentClient, config.CONTROL_TABLE),
    queueTelegramMessage,
    queueWhatsappMessage,
  ),
  registerTelegramIntegration: new RegisterTelegramIntegration(
    new TelegramBotApiClient(),
    telegramCredentialVault,
    telegramIntegrationStore,
    {
      webhookBaseUrl: config.TELEGRAM_WEBHOOK_BASE_URL,
    },
  ),
  registerWhatsappIntegration,
  rotateWhatsappAccessToken: new RotateWhatsappAccessToken(
    whatsappIntegrationAdminReader,
    whatsappCredentialVault,
    whatsappManagementApi,
  ),
});
