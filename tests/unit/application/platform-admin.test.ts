import { describe, expect, it, vi } from "vitest";

import type { PlatformAdminStore } from "../../../src/application/ports/platform-admin-store.js";
import type { OpenAICredentialVault } from "../../../src/application/ports/openai-credential-vault.js";
import {
  OpenAICredentialUnavailableError,
  OpenAICredentialVersionConflictError,
} from "../../../src/application/ports/openai-credential-vault.js";
import { PlatformAdmin } from "../../../src/application/platform-admin/platform-admin.js";

const createStore = () => {
  const deleteIntegrationData = vi.fn().mockResolvedValue({
    deletedChats: 0,
    integrationId: "int_test",
    mode: "CHATS_ONLY",
    status: "COMPLETED",
  });
  const listIntegrations = vi.fn().mockResolvedValue({ items: [] });
  const updateInboundMedia = vi.fn().mockResolvedValue({
    inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
    updatedAt: "2026-08-12T12:00:00.000Z",
  });
  return {
    deleteIntegrationData,
    listIntegrations,
    store: {
      deleteIntegrationData,
      listIntegrations,
      updateInboundMedia,
    } satisfies PlatformAdminStore,
    updateInboundMedia,
  };
};

const createVault = () => {
  const upsert = vi.fn().mockResolvedValue({
    configured: true,
    credentialVersion: 1,
    updatedAt: "2026-08-12T12:00:00.000Z",
  });
  const deleteCredential = vi.fn().mockResolvedValue({ configured: false });
  return {
    deleteCredential,
    upsert,
    vault: {
      batchStatus: vi.fn(),
      delete: deleteCredential,
      get: vi.fn(),
      status: vi.fn(),
      upsert,
    } satisfies OpenAICredentialVault,
  };
};

describe("PlatformAdmin", () => {
  it("delegates listing and inbound media updates", async () => {
    const { listIntegrations, store, updateInboundMedia } = createStore();
    const admin = new PlatformAdmin(store, createVault().vault);

    await expect(admin.listIntegrations({ cursor: "cursor_test" })).resolves.toEqual({ items: [] });
    await expect(
      admin.updateInboundMedia("int_test", {
        applicationId: "app_test",
        inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
        tenantId: "tenant_test",
      }),
    ).resolves.toMatchObject({
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
    });
    expect(listIntegrations).toHaveBeenCalledWith({ cursor: "cursor_test" });
    expect(updateInboundMedia).toHaveBeenCalledWith({
      applicationId: "app_test",
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
      integrationId: "int_test",
      tenantId: "tenant_test",
    });
  });

  it("requires the exact integration identifier before destructive operations", async () => {
    const { deleteIntegrationData, store } = createStore();
    const admin = new PlatformAdmin(store, createVault().vault);

    await expect(
      admin.deleteIntegrationData("int_test", {
        applicationId: "app_test",
        confirmation: "int_other",
        mode: "CHATS_ONLY",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "ADMIN_CONFIRMATION_INVALID", statusCode: 400 });
    expect(deleteIntegrationData).not.toHaveBeenCalled();
  });

  it("passes ownership and mode to the administration store", async () => {
    const { deleteIntegrationData, store } = createStore();
    const admin = new PlatformAdmin(store, createVault().vault);

    await admin.deleteIntegrationData("int_test", {
      applicationId: "app_test",
      confirmation: "int_test",
      mode: "INTEGRATION_AND_CHATS",
      tenantId: "tenant_test",
    });

    expect(deleteIntegrationData).toHaveBeenCalledWith({
      applicationId: "app_test",
      integrationId: "int_test",
      mode: "INTEGRATION_AND_CHATS",
      tenantId: "tenant_test",
    });
  });

  it("creates and rotates an integration-scoped OpenAI credential without returning its secret", async () => {
    const { store } = createStore();
    const { upsert, vault } = createVault();
    const admin = new PlatformAdmin(store, vault);
    const apiKey = "sk-integration-secret-value";

    const created = await admin.putOpenAiCredential("int_test", {
      apiKey,
      applicationId: "app_test",
      organization: "org_test",
      tenantId: "tenant_test",
    });
    const rotated = await admin.putOpenAiCredential("int_test", {
      apiKey: "sk-integration-rotated-value",
      applicationId: "app_test",
      expectedCredentialVersion: 1,
      project: "proj_test",
      tenantId: "tenant_test",
    });

    expect(upsert).toHaveBeenNthCalledWith(1, {
      apiKey,
      applicationId: "app_test",
      integrationId: "int_test",
      organization: "org_test",
      tenantId: "tenant_test",
    });
    expect(upsert).toHaveBeenNthCalledWith(2, {
      apiKey: "sk-integration-rotated-value",
      applicationId: "app_test",
      expectedCredentialVersion: 1,
      integrationId: "int_test",
      project: "proj_test",
      tenantId: "tenant_test",
    });
    expect(JSON.stringify([created, rotated])).not.toContain(apiKey);
  });

  it("maps stale credential versions to a public conflict and delegates atomic deletion", async () => {
    const { store } = createStore();
    const { deleteCredential, upsert, vault } = createVault();
    upsert.mockRejectedValueOnce(new OpenAICredentialVersionConflictError());
    const admin = new PlatformAdmin(store, vault);

    await expect(
      admin.putOpenAiCredential("int_test", {
        apiKey: "sk-integration-secret-value",
        applicationId: "app_test",
        expectedCredentialVersion: 7,
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({
      code: "OPENAI_CREDENTIAL_VERSION_CONFLICT",
      statusCode: 409,
    });
    await expect(
      admin.deleteOpenAiCredential("int_test", {
        applicationId: "app_test",
        expectedCredentialVersion: 2,
        tenantId: "tenant_test",
      }),
    ).resolves.toEqual({ configured: false });
    expect(deleteCredential).toHaveBeenCalledWith({
      applicationId: "app_test",
      expectedCredentialVersion: 2,
      integrationId: "int_test",
      tenantId: "tenant_test",
    });
  });

  it("does not reveal whether a credential belongs to another integration owner", async () => {
    const { store } = createStore();
    const { deleteCredential, upsert, vault } = createVault();
    upsert.mockRejectedValueOnce(new OpenAICredentialUnavailableError());
    deleteCredential.mockRejectedValueOnce(new OpenAICredentialUnavailableError());
    const admin = new PlatformAdmin(store, vault);

    await expect(
      admin.putOpenAiCredential("int_test", {
        apiKey: "sk-integration-secret-value",
        applicationId: "app_test",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_FOUND", statusCode: 404 });
    await expect(
      admin.deleteOpenAiCredential("int_test", {
        applicationId: "app_test",
        expectedCredentialVersion: 1,
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "INTEGRATION_NOT_FOUND", statusCode: 404 });
  });

  it("maps a stale version during credential deletion to a conflict", async () => {
    const { store } = createStore();
    const { deleteCredential, vault } = createVault();
    deleteCredential.mockRejectedValueOnce(new OpenAICredentialVersionConflictError());
    const admin = new PlatformAdmin(store, vault);

    await expect(
      admin.deleteOpenAiCredential("int_test", {
        applicationId: "app_test",
        expectedCredentialVersion: 1,
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({
      code: "OPENAI_CREDENTIAL_VERSION_CONFLICT",
      statusCode: 409,
    });
  });
});
