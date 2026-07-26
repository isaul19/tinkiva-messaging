import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoWhatsappIntegrationAdminReader } from "../../../src/infrastructure/dynamodb/dynamo-whatsapp-integration-admin-reader.js";

const integrationItem = {
  applicationId: "app_test",
  graphApiVersion: "v25.0",
  integrationId: "int_test",
  phoneNumberId: "phone_test",
  provider: "WHATSAPP",
  providerConnectionId: "pc_test",
  status: "ACTIVE",
  tenantId: "tenant_test",
  wabaId: "waba_test",
};

describe("DynamoWhatsappIntegrationAdminReader", () => {
  it("joins integration and provider connection metadata with consistent reads", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: integrationItem })
      .mockResolvedValueOnce({
        Item: {
          applicationId: "app_test",
          metaAppId: "meta_app_test",
          provider: "WHATSAPP",
          providerConnectionId: "pc_test",
          tenantId: "tenant_test",
          wabaId: "waba_test",
        },
      });
    const reader = new DynamoWhatsappIntegrationAdminReader(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
    );

    await expect(
      reader.get({
        applicationId: "app_test",
        integrationId: "int_test",
        tenantId: "tenant_test",
      }),
    ).resolves.toEqual({
      ...integrationItem,
      metaAppId: "meta_app_test",
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetCommand);
  });

  it("returns undefined for cross-application records and inconsistent connections", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: { ...integrationItem, applicationId: "another-app" },
      })
      .mockResolvedValueOnce({ Item: integrationItem })
      .mockResolvedValueOnce({
        Item: {
          applicationId: "app_test",
          metaAppId: "meta_app_test",
          provider: "WHATSAPP",
          providerConnectionId: "another-connection",
          tenantId: "tenant_test",
          wabaId: "waba_test",
        },
      });
    const reader = new DynamoWhatsappIntegrationAdminReader(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
    );

    await expect(
      reader.get({
        applicationId: "app_test",
        integrationId: "int_test",
        tenantId: "tenant_test",
      }),
    ).resolves.toBeUndefined();
    await expect(
      reader.get({
        applicationId: "app_test",
        integrationId: "int_test",
        tenantId: "tenant_test",
      }),
    ).resolves.toBeUndefined();
  });
});
