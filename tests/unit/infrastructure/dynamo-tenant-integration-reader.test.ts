import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoTenantIntegrationReader } from "../../../src/infrastructure/dynamodb/dynamo-tenant-integration-reader.js";

const tenantId = "tenant_01JTESTLIST0000000000000";
const applicationId = "app_test";

describe("DynamoTenantIntegrationReader", () => {
  it("lists Telegram and WhatsApp metadata with credential versions but no secrets", async () => {
    const send = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof QueryCommand) {
        expect(command.input.ConsistentRead).toBe(true);
        return {
          Items: [
            { integrationId: "int_telegram", provider: "TELEGRAM" },
            { integrationId: "int_whatsapp", provider: "WHATSAPP" },
          ],
        };
      }

      if (!(command instanceof GetCommand)) {
        throw new Error("Unexpected DynamoDB command.");
      }

      const key = command.input.Key as Record<string, unknown> | undefined;
      const pk = key?.PK;
      if (pk === "INTEGRATION#int_telegram") {
        return {
          Item: {
            applicationId,
            botId: "777888",
            botUsername: "storagia_test_bot",
            createdAt: "2026-07-25T19:00:00.000Z",
            displayName: "Storagia Telegram",
            integrationId: "int_telegram",
            provider: "TELEGRAM",
            providerAccountId: "777888",
            providerConnectionId: "pc_telegram",
            status: "ACTIVE",
            tenantId,
          },
        };
      }
      if (pk === "INTEGRATION#int_whatsapp") {
        return {
          Item: {
            applicationId,
            createdAt: "2026-07-25T20:00:00.000Z",
            displayName: "Storagia WhatsApp",
            displayPhoneNumber: "+51 904 843 582",
            inboundMedia: {
              audioAlternativeText: true,
              imageAlternativeText: false,
            },
            integrationId: "int_whatsapp",
            phoneNumberId: "1265721213282879",
            provider: "WHATSAPP",
            providerAccountId: "1265721213282879",
            providerConnectionId: "pc_whatsapp",
            status: "ACTIVE",
            tenantId,
            verifiedName: "Tinkiva Software",
          },
        };
      }
      if (pk === "PROVIDER_CONNECTION#pc_telegram") {
        expect(command.input.ProjectionExpression).not.toContain("credentialCiphertext");
        return {
          Item: {
            applicationId,
            credentialVersion: 1,
            provider: "TELEGRAM",
            providerConnectionId: "pc_telegram",
            tenantId,
          },
        };
      }
      if (pk === "PROVIDER_CONNECTION#pc_whatsapp") {
        expect(command.input.ProjectionExpression).not.toContain("credentialCiphertext");
        return {
          Item: {
            applicationId,
            credentialVersion: 2,
            provider: "WHATSAPP",
            providerConnectionId: "pc_whatsapp",
            tenantId,
          },
        };
      }

      throw new Error("Unexpected DynamoDB key.");
    });
    const reader = new DynamoTenantIntegrationReader(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
    );

    await expect(reader.list({ applicationId, tenantId })).resolves.toEqual([
      {
        botId: "777888",
        botUsername: "storagia_test_bot",
        createdAt: "2026-07-25T19:00:00.000Z",
        credentialVersion: 1,
        displayName: "Storagia Telegram",
        inboundMedia: {
          audioAlternativeText: false,
          imageAlternativeText: false,
        },
        integrationId: "int_telegram",
        provider: "TELEGRAM",
        providerAccountId: "777888",
        status: "ACTIVE",
        tenantId,
      },
      {
        createdAt: "2026-07-25T20:00:00.000Z",
        credentialVersion: 2,
        displayName: "Storagia WhatsApp",
        displayPhoneNumber: "+51 904 843 582",
        inboundMedia: {
          audioAlternativeText: true,
          imageAlternativeText: false,
        },
        integrationId: "int_whatsapp",
        phoneNumberId: "1265721213282879",
        provider: "WHATSAPP",
        providerAccountId: "1265721213282879",
        status: "ACTIVE",
        tenantId,
        verifiedName: "Tinkiva Software",
      },
    ]);
  });

  it("returns an empty list and rejects cross-application metadata", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({
        Items: [{ integrationId: "int_wrong", provider: "WHATSAPP" }],
      })
      .mockResolvedValueOnce({
        Item: {
          applicationId: "another-app",
          createdAt: "2026-07-25T20:00:00.000Z",
          displayName: "Wrong app",
          integrationId: "int_wrong",
          phoneNumberId: "123",
          provider: "WHATSAPP",
          providerAccountId: "123",
          providerConnectionId: "pc_wrong",
          status: "ACTIVE",
          tenantId,
        },
      });
    const reader = new DynamoTenantIntegrationReader(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
    );

    await expect(reader.list({ applicationId, tenantId })).resolves.toEqual([]);
    await expect(reader.list({ applicationId, tenantId })).rejects.toThrow(
      "Tenant integration metadata is inconsistent.",
    );
  });
});
