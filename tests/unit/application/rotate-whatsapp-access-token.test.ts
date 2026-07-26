import { describe, expect, it, vi } from "vitest";

import { ProviderCredentialVersionConflictError } from "../../../src/application/ports/provider-credential-vault-errors.js";
import type { WhatsappCredentialVault } from "../../../src/application/ports/whatsapp-credential-vault.js";
import type { WhatsappIntegrationAdminReader } from "../../../src/application/ports/whatsapp-integration-admin-reader.js";
import type { WhatsappManagementApi } from "../../../src/application/ports/whatsapp-management-api.js";
import { RotateWhatsappAccessToken } from "../../../src/application/whatsapp/rotate-whatsapp-access-token.js";

const integration = {
  applicationId: "app_test",
  graphApiVersion: "v25.0",
  integrationId: "int_01JTESTROTATION000000000000",
  metaAppId: "1393451145991555",
  phoneNumberId: "1265721213282879",
  providerConnectionId: "pc_01JTESTROTATION0000000000000",
  status: "ACTIVE" as const,
  tenantId: "tenant_01JTESTROTATION0000000000",
  wabaId: "1373995794700687",
};

const command = {
  applicationId: integration.applicationId,
  integrationId: integration.integrationId,
  request: {
    accessToken: "new-whatsapp-access-token-for-tests",
    expectedCredentialVersion: 1,
  },
  tenantId: integration.tenantId,
};

const createDependencies = () => {
  const integrations = {
    get: vi.fn().mockResolvedValue(integration),
  } satisfies WhatsappIntegrationAdminReader;
  const credentials = {
    create: vi.fn(),
    deleteImmediately: vi.fn(),
    get: vi.fn().mockResolvedValue({
      accessToken: "old-whatsapp-access-token-for-tests",
      appSecret: "meta-app-secret-for-tests",
      verifyToken: "verify-token-for-tests-1234567890",
    }),
    rotate: vi.fn().mockResolvedValue({
      credentialVersion: 2,
      updatedAt: "2026-07-26T03:00:00.000Z",
    }),
  } satisfies WhatsappCredentialVault;
  const managementApi = {
    getPhoneNumbers: vi.fn().mockResolvedValue([{ id: integration.phoneNumberId }]),
    inspectAccessToken: vi.fn().mockResolvedValue({
      appId: integration.metaAppId,
      dataAccessExpiresAt: 1_800_000_000,
      expiresAt: 1_799_000_000,
      isValid: true,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      type: "USER",
    }),
    subscribeWaba: vi.fn(),
  } satisfies WhatsappManagementApi;

  return { credentials, integrations, managementApi };
};

describe("RotateWhatsappAccessToken", () => {
  it("validates and rotates only the access token while preserving webhook secrets", async () => {
    const dependencies = createDependencies();
    const useCase = new RotateWhatsappAccessToken(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.managementApi,
    );

    await expect(useCase.execute(command)).resolves.toEqual({
      credentialVersion: 2,
      integrationId: integration.integrationId,
      provider: "WHATSAPP",
      status: "ACTIVE",
      tenantId: integration.tenantId,
      tokenDataAccessExpiresAt: "2027-01-15T08:00:00.000Z",
      tokenExpiresAt: "2027-01-03T18:13:20.000Z",
      tokenType: "USER",
      updatedAt: "2026-07-26T03:00:00.000Z",
    });
    expect(dependencies.credentials.rotate).toHaveBeenCalledWith({
      accessToken: command.request.accessToken,
      applicationId: integration.applicationId,
      appSecret: "meta-app-secret-for-tests",
      expectedCredentialVersion: 1,
      providerConnectionId: integration.providerConnectionId,
      tenantId: integration.tenantId,
      verifyToken: "verify-token-for-tests-1234567890",
    });
  });

  it("rejects a token from another Meta app or without both WhatsApp scopes", async () => {
    const dependencies = createDependencies();
    dependencies.managementApi.inspectAccessToken.mockResolvedValue({
      appId: "different-app",
      isValid: true,
      scopes: ["whatsapp_business_management"],
    });
    const useCase = new RotateWhatsappAccessToken(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.managementApi,
    );

    await expect(useCase.execute(command)).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_INVALID",
      statusCode: 400,
    });
    expect(dependencies.credentials.rotate).not.toHaveBeenCalled();
  });

  it("rejects a token that cannot access the registered phone number", async () => {
    const dependencies = createDependencies();
    dependencies.managementApi.getPhoneNumbers.mockResolvedValue([{ id: "another-phone" }]);
    const useCase = new RotateWhatsappAccessToken(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.managementApi,
    );

    await expect(useCase.execute(command)).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_INVALID",
      statusCode: 400,
    });
  });

  it("returns a conflict when the expected credential version is stale", async () => {
    const dependencies = createDependencies();
    dependencies.credentials.rotate.mockRejectedValue(new ProviderCredentialVersionConflictError());
    const useCase = new RotateWhatsappAccessToken(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.managementApi,
    );

    await expect(useCase.execute(command)).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_VERSION_CONFLICT",
      statusCode: 409,
    });
  });

  it("hides missing integrations and blocks non-active integrations", async () => {
    const dependencies = createDependencies();
    dependencies.integrations.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      ...integration,
      status: "ERROR",
    });
    const useCase = new RotateWhatsappAccessToken(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.managementApi,
    );

    await expect(useCase.execute(command)).rejects.toMatchObject({
      code: "INTEGRATION_NOT_FOUND",
      statusCode: 404,
    });
    await expect(useCase.execute(command)).rejects.toMatchObject({
      code: "INTEGRATION_DISABLED",
      statusCode: 409,
    });
  });
});
