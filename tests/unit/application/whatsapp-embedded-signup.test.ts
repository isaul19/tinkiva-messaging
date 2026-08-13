import { describe, expect, it, vi } from "vitest";

import type { WhatsappEmbeddedSignupApi } from "../../../src/application/ports/whatsapp-embedded-signup-api.js";
import type { WhatsappEmbeddedSignupConfigurationReader } from "../../../src/application/ports/whatsapp-embedded-signup-configuration.js";
import type { WhatsappManagementApi } from "../../../src/application/ports/whatsapp-management-api.js";
import { CompleteWhatsappEmbeddedSignup } from "../../../src/application/whatsapp/complete-whatsapp-embedded-signup.js";
import { GetWhatsappEmbeddedSignupConfiguration } from "../../../src/application/whatsapp/get-whatsapp-embedded-signup-configuration.js";

const platformConfiguration = {
  appId: "1393451145991555",
  appSecret: "meta-platform-app-secret-for-tests",
  configurationId: "987654321012345",
  configurationVersion: 1,
  status: "ACTIVE" as const,
};

const request = {
  authorizationCode: "one-time-embedded-signup-authorization-code",
  businessPortfolioId: "111222333444555",
  displayName: "Storagia customer WhatsApp",
  inboundMedia: {
    audioAlternativeText: true,
    imageAlternativeText: false,
  },
  phoneNumberId: "1265721213282879",
  wabaId: "1373995794700687",
};

const integration = {
  credentialVersion: 1,
  displayName: request.displayName,
  inboundMedia: request.inboundMedia,
  integrationId: "int_01JEMBEDDEDSIGNUP0000000000",
  phoneNumberId: request.phoneNumberId,
  provider: "WHATSAPP" as const,
  status: "ACTIVE" as const,
  tenantId: "tenant_01JEMBEDDEDSIGNUP0000000",
  webhookUrl: "https://messaging.example/webhooks/whatsapp/opaque",
};

const dependencies = () => {
  const configuration = {
    get: vi.fn().mockResolvedValue(platformConfiguration),
    getPublic: vi.fn().mockResolvedValue(platformConfiguration),
  } satisfies WhatsappEmbeddedSignupConfigurationReader;
  const embeddedSignupApi = {
    exchangeAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: "business-integration-system-user-token",
      tokenType: "bearer",
    }),
  } satisfies WhatsappEmbeddedSignupApi;
  const managementApi = {
    inspectAccessToken: vi.fn().mockResolvedValue({
      appId: platformConfiguration.appId,
      isValid: true,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      type: "BUSINESS",
    }),
  } satisfies Pick<WhatsappManagementApi, "inspectAccessToken">;
  const registerIntegration = {
    execute: vi.fn().mockResolvedValue(integration),
  };

  return { configuration, embeddedSignupApi, managementApi, registerIntegration };
};

describe("WhatsApp Embedded Signup application flow", () => {
  it("returns browser-safe configuration without the App Secret", async () => {
    const deps = dependencies();
    const useCase = new GetWhatsappEmbeddedSignupConfiguration(deps.configuration, {
      graphApiVersion: "v25.0",
    });

    await expect(useCase.execute()).resolves.toEqual({
      appId: platformConfiguration.appId,
      configurationId: platformConfiguration.configurationId,
      configured: true,
      graphApiVersion: "v25.0",
    });
    expect(JSON.stringify(await useCase.execute())).not.toContain(platformConfiguration.appSecret);
  });

  it("reports an unconfigured stage without exposing partial values", async () => {
    const deps = dependencies();
    deps.configuration.getPublic.mockResolvedValue(undefined);
    const useCase = new GetWhatsappEmbeddedSignupConfiguration(deps.configuration, {
      graphApiVersion: "v25.0",
    });

    await expect(useCase.execute()).resolves.toEqual({
      configured: false,
      graphApiVersion: "v25.0",
    });
  });

  it("exchanges the one-time code, validates the app/scopes, and reuses secure registration", async () => {
    const deps = dependencies();
    const useCase = new CompleteWhatsappEmbeddedSignup(
      deps.configuration,
      deps.embeddedSignupApi,
      deps.managementApi,
      deps.registerIntegration,
      { graphApiVersion: "v25.0" },
    );

    await expect(
      useCase.execute({
        applicationId: "app_test",
        request,
        tenantId: integration.tenantId,
      }),
    ).resolves.toEqual(integration);
    expect(deps.embeddedSignupApi.exchangeAuthorizationCode).toHaveBeenCalledWith({
      appId: platformConfiguration.appId,
      appSecret: platformConfiguration.appSecret,
      authorizationCode: request.authorizationCode,
      graphApiVersion: "v25.0",
    });
    expect(deps.registerIntegration.execute).toHaveBeenCalledWith({
      applicationId: "app_test",
      request: {
        accessToken: "business-integration-system-user-token",
        appSecret: platformConfiguration.appSecret,
        businessPortfolioId: request.businessPortfolioId,
        displayName: request.displayName,
        inboundMedia: request.inboundMedia,
        metaAppId: platformConfiguration.appId,
        phoneNumberId: request.phoneNumberId,
        wabaId: request.wabaId,
      },
      tenantId: integration.tenantId,
    });
  });

  it("blocks completion when platform configuration or required token permissions are missing", async () => {
    const deps = dependencies();
    deps.configuration.get.mockResolvedValueOnce(undefined);
    deps.managementApi.inspectAccessToken.mockResolvedValueOnce({
      appId: platformConfiguration.appId,
      isValid: true,
      scopes: ["whatsapp_business_management"],
    });
    const useCase = new CompleteWhatsappEmbeddedSignup(
      deps.configuration,
      deps.embeddedSignupApi,
      deps.managementApi,
      deps.registerIntegration,
      { graphApiVersion: "v25.0" },
    );

    await expect(
      useCase.execute({
        applicationId: "app_test",
        request,
        tenantId: integration.tenantId,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CONFIGURATION_INVALID",
      statusCode: 409,
    });
    await expect(
      useCase.execute({
        applicationId: "app_test",
        request,
        tenantId: integration.tenantId,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_INVALID",
      statusCode: 400,
    });
    expect(deps.registerIntegration.execute).not.toHaveBeenCalled();
  });
});
