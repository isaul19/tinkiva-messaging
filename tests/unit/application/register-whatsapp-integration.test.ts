import { describe, expect, it, vi } from "vitest";

import type { CreateWhatsappCredentialInput } from "../../../src/application/ports/whatsapp-credential-vault.js";
import type { WhatsappManagementApi } from "../../../src/application/ports/whatsapp-management-api.js";
import { RegisterWhatsappIntegration } from "../../../src/application/whatsapp/register-whatsapp-integration.js";

const request = {
  accessToken: "access-token-".padEnd(40, "x"),
  appSecret: "app-secret-".padEnd(32, "s"),
  businessPortfolioId: "112233",
  displayName: "WhatsApp Ventas",
  metaAppId: "445566",
  phoneNumberId: "778899",
  wabaId: "991122",
};

const createDependencies = () => {
  const credentialInputs: CreateWhatsappCredentialInput[] = [];
  const subscriptionInputs: Parameters<WhatsappManagementApi["subscribeWaba"]>[0][] = [];
  const managementApi = {
    getPhoneNumbers: vi.fn().mockResolvedValue([
      {
        displayPhoneNumber: "+57 300 000 0000",
        id: request.phoneNumberId,
        verifiedName: "Tinkiva",
      },
    ]),
    subscribeWaba: vi.fn((input: Parameters<WhatsappManagementApi["subscribeWaba"]>[0]) => {
      subscriptionInputs.push(input);
      return Promise.resolve();
    }),
  };
  const credentials = {
    create: vi.fn((input: CreateWhatsappCredentialInput) => {
      credentialInputs.push(input);
      return Promise.resolve(input.providerConnectionId);
    }),
    deleteImmediately: vi.fn().mockResolvedValue(undefined),
  };
  const store = {
    createPending: vi.fn().mockResolvedValue(undefined),
    setStatus: vi.fn().mockResolvedValue(undefined),
  };

  return { credentialInputs, credentials, managementApi, store, subscriptionInputs };
};

describe("RegisterWhatsappIntegration", () => {
  it("validates the phone, stores encrypted credential metadata, and subscribes the WABA", async () => {
    const dependencies = createDependencies();
    const useCase = new RegisterWhatsappIntegration(
      dependencies.managementApi,
      dependencies.credentials,
      dependencies.store,
      {
        graphApiVersion: "v25.0",
        webhookBaseUrl: "https://messaging.example/",
      },
    );

    const result = await useCase.execute({
      applicationId: "app_test",
      request,
      tenantId: "tenant_test",
    });

    expect(result).toMatchObject({
      displayName: request.displayName,
      displayPhoneNumber: "+57 300 000 0000",
      phoneNumberId: request.phoneNumberId,
      provider: "WHATSAPP",
      status: "ACTIVE",
      tenantId: "tenant_test",
      verifiedName: "Tinkiva",
    });
    expect(result.integrationId).toMatch(/^int_/);
    expect(result.webhookUrl).toMatch(
      /^https:\/\/messaging\.example\/webhooks\/whatsapp\/[A-Za-z0-9_-]{32,}$/,
    );

    const credentialInput = dependencies.credentialInputs[0];
    const subscriptionInput = dependencies.subscriptionInputs[0];
    expect(credentialInput).toBeDefined();
    expect(subscriptionInput).toBeDefined();
    if (credentialInput === undefined || subscriptionInput === undefined) {
      throw new Error("Expected WhatsApp onboarding inputs were not captured.");
    }
    expect(credentialInput).toMatchObject({
      accessToken: request.accessToken,
      applicationId: "app_test",
      appSecret: request.appSecret,
      tenantId: "tenant_test",
    });
    expect(credentialInput.verifyToken).toHaveLength(43);
    expect(subscriptionInput).toMatchObject({
      accessToken: request.accessToken,
      callbackUrl: result.webhookUrl,
      graphApiVersion: "v25.0",
      verifyToken: credentialInput.verifyToken,
      wabaId: request.wabaId,
    });
    expect(dependencies.store.setStatus).toHaveBeenCalledWith(
      result.integrationId,
      request.phoneNumberId,
      credentialInput.providerConnectionId,
      "tenant_test",
      request.wabaId,
      expect.any(String),
      "ACTIVE",
      expect.any(String),
    );
  });

  it("rejects a phone number outside the WABA before storing credentials", async () => {
    const dependencies = createDependencies();
    dependencies.managementApi.getPhoneNumbers.mockResolvedValue([]);
    const useCase = new RegisterWhatsappIntegration(
      dependencies.managementApi,
      dependencies.credentials,
      dependencies.store,
      {
        graphApiVersion: "v25.0",
        webhookBaseUrl: "https://messaging.example",
      },
    );

    await expect(
      useCase.execute({
        applicationId: "app_test",
        request,
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_INVALID",
      statusCode: 400,
    });
    expect(dependencies.credentials.create).not.toHaveBeenCalled();
  });

  it("marks the integration as errored when Meta rejects the subscription", async () => {
    const dependencies = createDependencies();
    dependencies.managementApi.subscribeWaba.mockRejectedValue(new Error("subscription failed"));
    const useCase = new RegisterWhatsappIntegration(
      dependencies.managementApi,
      dependencies.credentials,
      dependencies.store,
      {
        graphApiVersion: "v25.0",
        webhookBaseUrl: "https://messaging.example",
      },
    );

    await expect(
      useCase.execute({
        applicationId: "app_test",
        request,
        tenantId: "tenant_test",
      }),
    ).rejects.toThrow("subscription failed");
    expect(dependencies.store.setStatus).toHaveBeenLastCalledWith(
      expect.any(String),
      request.phoneNumberId,
      expect.any(String),
      "tenant_test",
      request.wabaId,
      expect.any(String),
      "ERROR",
      expect.any(String),
    );
  });
});
