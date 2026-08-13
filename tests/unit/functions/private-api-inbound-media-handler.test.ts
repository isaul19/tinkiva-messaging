import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    CONTROL_TABLE: "control-test",
    DATA_TABLE: "data-test",
    MEDIA_BUCKET: "media-test",
    PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/test",
    REALTIME_TICKET_TTL_SECONDS: "60",
    REALTIME_WEBSOCKET_URL: "wss://realtime.example/test",
    STAGE: "test",
    TELEGRAM_OUTBOUND_QUEUE_URL: "https://sqs.example/telegram",
    TELEGRAM_WEBHOOK_BASE_URL: "https://gateway.example",
    TINKIVA_INTEGRATIONS_TABLE: "tenant-integrations-test",
    WHATSAPP_GRAPH_API_VERSION: "v25.0",
    WHATSAPP_OUTBOUND_QUEUE_URL: "https://sqs.example/whatsapp",
    WHATSAPP_WEBHOOK_BASE_URL: "https://gateway.example",
  });
});

import { createPrivateApiHandler } from "../../../src/functions/private-api/handler.js";

const identity = {
  applicationId: "app_storagia",
  clientId: "msgc_storagia",
  scope: "integrations:write",
};

describe("private API inbound media settings", () => {
  const getTenant = { byExternalAccount: vi.fn(), byTenantId: vi.fn() };
  const updateInboundMedia = { updateInboundMedia: vi.fn() };
  const noop = { execute: vi.fn() };
  const handler = createPrivateApiHandler({
    completeWhatsappEmbeddedSignup: noop,
    createRealtimeTicket: noop,
    deleteConversation: noop,
    ensureTenant: noop,
    getTenant,
    getWhatsappEmbeddedSignupConfiguration: noop,
    listConversationMessages: noop,
    listConversations: noop,
    listTenantIntegrations: noop,
    queueMessage: noop,
    registerTelegramIntegration: noop,
    registerWhatsappIntegration: noop,
    rotateWhatsappAccessToken: noop,
    updateInboundMedia,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getTenant.byTenantId.mockResolvedValue({ tenantId: "tenant_test" });
    updateInboundMedia.updateInboundMedia.mockResolvedValue({
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
  });

  it("updates only the integration owned by the authorized application and tenant", async () => {
    const response = await handler({
      body: JSON.stringify({ audioAlternativeText: true, imageAlternativeText: false }),
      headers: {},
      isBase64Encoded: false,
      pathParameters: { integrationId: "int_test", tenantId: "tenant_test" },
      requestContext: { authorizer: { lambda: identity } },
      routeKey: "PATCH /v1/tenants/{tenantId}/integrations/{integrationId}/inbound-media",
    } as unknown as APIGatewayProxyEventV2);

    expect(response.statusCode).toBe(200);
    expect(getTenant.byTenantId).toHaveBeenCalledWith("app_storagia", "tenant_test");
    expect(updateInboundMedia.updateInboundMedia).toHaveBeenCalledWith({
      applicationId: "app_storagia",
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
      integrationId: "int_test",
      tenantId: "tenant_test",
    });
  });
});
