import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CONTROL_TABLE = "control-test";
  process.env.DATA_TABLE = "data-test";
  process.env.MEDIA_BUCKET = "media-test";
  process.env.PROVIDER_CREDENTIALS_KEY_ARN = "arn:aws:kms:us-east-1:123456789012:key/test";
  process.env.STAGE = "test";
});

import { createPlatformAdminHandler } from "../../../src/functions/platform-admin/handler.js";

const adminIdentity = {
  applicationId: "app_admin",
  clientId: "msgc_admin",
  scope: "platform:admin",
};

const event = (
  routeKey: string,
  options: {
    body?: unknown;
    identity?: typeof adminIdentity;
    integrationId?: string;
  } = {},
) =>
  ({
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {},
    isBase64Encoded: false,
    pathParameters:
      options.integrationId === undefined ? undefined : { integrationId: options.integrationId },
    requestContext: {
      authorizer: { lambda: options.identity ?? adminIdentity },
    },
    routeKey,
  }) as unknown as APIGatewayProxyEventV2;

describe("platform admin handler", () => {
  const platformAdmin = {
    deleteIntegrationData: vi.fn(),
    deleteOpenAiCredential: vi.fn(),
    listIntegrations: vi.fn(),
    putOpenAiCredential: vi.fn(),
    updateInboundMedia: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    platformAdmin.listIntegrations.mockResolvedValue({ items: [] });
    platformAdmin.updateInboundMedia.mockResolvedValue({
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    platformAdmin.putOpenAiCredential.mockResolvedValue({
      configured: true,
      credentialVersion: 1,
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    platformAdmin.deleteOpenAiCredential.mockResolvedValue({ configured: false });
    platformAdmin.deleteIntegrationData.mockResolvedValue({
      deletedChats: 10,
      integrationId: "int_test",
      mode: "CHATS_ONLY",
      status: "IN_PROGRESS",
    });
  });

  it("serves a no-store CSP-protected login that exchanges the global client credentials", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(event("GET /admin"));

    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
    });
    expect(result.headers?.["content-security-policy"]).toContain("default-src 'none'");
    expect(result.headers?.["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(result.body).toContain("sessionStorage");
    expect(result.body).not.toContain("localStorage");
    expect(result.body).toContain('id="client-id"');
    expect(result.body).toContain('id="client-secret"');
    expect(result.body).toContain('fetch("/v1/auth/token"');
    expect(result.body).toContain("/tinkiva/messaging/test/applications/platform_admin/client");
    expect(result.body).toContain("AWS Secrets Manager");
    expect(result.body).toContain("sessionStorage.setItem(TOKEN_KEY, accessToken)");
    expect(result.body).not.toContain("sessionStorage.setItem(TOKEN_KEY, clientId)");
    expect(result.body).not.toContain("sessionStorage.setItem(TOKEN_KEY, clientSecret)");
    expect(result.body).not.toContain("Bearer token con scope");
    expect(result.body).toContain('apiKey.type = "password"');
    expect(result.body).toContain('apiKey.autocomplete = "new-password"');
  });

  it("clears login secrets and invalid stored tokens on every authentication outcome", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(event("GET /admin"));
    const body = result.body ?? "";

    expect(body).toContain('finally {\n      clientSecretInput.value = "";');
    expect(body).toContain("Client ID o client secret inválidos.");
    expect(body).toContain("no incluye el scope platform:admin");
    expect(body.match(/sessionStorage\.removeItem\(TOKEN_KEY\)/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it("requires platform:admin for the protected API", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(
      event("GET /v1/platform/integrations", {
        identity: { ...adminIdentity, scope: "integrations:read" },
      }),
    );

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      error: { code: "AUTH_SCOPE_MISSING" },
    });
    expect(platformAdmin.listIntegrations).not.toHaveBeenCalled();
  });

  it("updates the two inbound media flags for an explicitly owned integration", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(
      event("PATCH /v1/platform/integrations/{integrationId}/inbound-media", {
        body: {
          applicationId: "app_test",
          inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
          tenantId: "tenant_test",
        },
        integrationId: "int_test",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(platformAdmin.updateInboundMedia).toHaveBeenCalledWith("int_test", {
      applicationId: "app_test",
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
      tenantId: "tenant_test",
    });
  });

  it("creates or rotates a credential and never serializes the API key in the response", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const apiKey = "sk-integration-secret-value";
    const result = await handler(
      event("PUT /v1/platform/integrations/{integrationId}/openai-credential", {
        body: {
          apiKey,
          applicationId: "app_test",
          organization: "org_test",
          tenantId: "tenant_test",
        },
        integrationId: "int_test",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(platformAdmin.putOpenAiCredential).toHaveBeenCalledWith("int_test", {
      apiKey,
      applicationId: "app_test",
      organization: "org_test",
      tenantId: "tenant_test",
    });
    expect(JSON.parse(result.body ?? "{}")).toEqual({
      configured: true,
      credentialVersion: 1,
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(result.body).not.toContain(apiKey);
  });

  it("fails closed if a credential dependency ever returns secret material", async () => {
    const apiKey = "sk-must-never-cross-the-api-boundary";
    platformAdmin.putOpenAiCredential.mockResolvedValueOnce({
      apiKey,
      configured: true,
      credentialVersion: 1,
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(
      event("PUT /v1/platform/integrations/{integrationId}/openai-credential", {
        body: {
          apiKey: "sk-integration-secret-value",
          applicationId: "app_test",
          tenantId: "tenant_test",
        },
        integrationId: "int_test",
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).not.toContain(apiKey);
  });

  it("deletes a credential by expected version without returning secret material", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(
      event("DELETE /v1/platform/integrations/{integrationId}/openai-credential", {
        body: {
          applicationId: "app_test",
          expectedCredentialVersion: 3,
          tenantId: "tenant_test",
        },
        integrationId: "int_test",
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(platformAdmin.deleteOpenAiCredential).toHaveBeenCalledWith("int_test", {
      applicationId: "app_test",
      expectedCredentialVersion: 3,
      tenantId: "tenant_test",
    });
    expect(JSON.parse(result.body ?? "{}")).toEqual({ configured: false });
  });

  it("refuses blind credential deletion without an expected version", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(
      event("DELETE /v1/platform/integrations/{integrationId}/openai-credential", {
        body: { applicationId: "app_test", tenantId: "tenant_test" },
        integrationId: "int_test",
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(platformAdmin.deleteOpenAiCredential).not.toHaveBeenCalled();
  });

  it("returns 202 while a bounded deletion needs another request", async () => {
    const handler = createPlatformAdminHandler({ platformAdmin, stage: "test" });
    const result = await handler(
      event("POST /v1/platform/integrations/{integrationId}/deletions", {
        body: {
          applicationId: "app_test",
          confirmation: "int_test",
          mode: "CHATS_ONLY",
          tenantId: "tenant_test",
        },
        integrationId: "int_test",
      }),
    );

    expect(result.statusCode).toBe(202);
    expect(platformAdmin.deleteIntegrationData).toHaveBeenCalledWith("int_test", {
      applicationId: "app_test",
      confirmation: "int_test",
      mode: "CHATS_ONLY",
      tenantId: "tenant_test",
    });
  });
});
