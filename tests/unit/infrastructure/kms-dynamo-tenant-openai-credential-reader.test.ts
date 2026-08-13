import { DecryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { OpenAICredentialUnavailableError } from "../../../src/application/ports/openai-credential-vault.js";
import { KmsDynamoTenantOpenAICredentialReader } from "../../../src/infrastructure/dynamodb/kms-dynamo-tenant-openai-credential-reader.js";

const scope = {
  applicationId: "app_test",
  integrationId: "int_test",
  tenantId: "tenant_test",
};
const keyId = "arn:aws:kms:us-east-1:123456789012:key/test";
const credentialTenantId = "account_test";
const item = {
  PK: `TENANT#${credentialTenantId}`,
  SK: "PROVIDER#OPENAI",
  credentialEncrypted: Buffer.from("ciphertext").toString("base64"),
  credentialLast4: "test",
  credentialStatus: "VALID",
  enabled: true,
  provider: "OPENAI",
  tenantId: credentialTenantId,
  updatedAt: "2026-08-12T12:00:00.000Z",
};

describe("KmsDynamoTenantOpenAICredentialReader", () => {
  it("reads and decrypts the tenant credential once during the cache TTL", async () => {
    const dynamoSend = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof QueryCommand) {
        expect(command.input.TableName).toBe("control-test");
        return Promise.resolve({
          Items: [
            {
              applicationId: scope.applicationId,
              externalAccountId: credentialTenantId,
              status: "ACTIVE",
              tenantId: scope.tenantId,
            },
          ],
        });
      }
      expect(command).toBeInstanceOf(GetCommand);
      expect((command as GetCommand).input).toMatchObject({
        Key: { PK: `TENANT#${credentialTenantId}`, SK: "PROVIDER#OPENAI" },
        TableName: "tenant-integrations-test",
      });
      return Promise.resolve({ Item: item });
    });
    const kmsSend = vi.fn((command: unknown): Promise<unknown> => {
      expect(command).toBeInstanceOf(DecryptCommand);
      expect((command as DecryptCommand).input).toMatchObject({
        EncryptionContext: { provider: "OPENAI", tenantId: credentialTenantId },
        KeyId: keyId,
      });
      return Promise.resolve({ Plaintext: Buffer.from("sk-tenant-openai-key-for-tests") });
    });
    const reader = new KmsDynamoTenantOpenAICredentialReader(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: kmsSend } as unknown as KMSClient,
      {
        applicationId: scope.applicationId,
        controlTable: "control-test",
        keyId,
        tableName: "tenant-integrations-test",
      },
    );

    await expect(reader.get(scope)).resolves.toEqual({
      apiKey: "sk-tenant-openai-key-for-tests",
    });
    await expect(reader.get({ ...scope, integrationId: "int_other" })).resolves.toEqual({
      apiKey: "sk-tenant-openai-key-for-tests",
    });
    expect(dynamoSend).toHaveBeenCalledTimes(2);
    expect(kmsSend).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", undefined],
    ["disabled", { ...item, enabled: false }],
    ["invalid", { ...item, credentialStatus: "INVALID" }],
    ["another tenant", { ...item, tenantId: "tenant_other" }],
  ])("rejects a %s tenant credential without decrypting", async (_label, record) => {
    const kmsSend = vi.fn();
    const dynamoSend = vi.fn((command: unknown): Promise<unknown> =>
      command instanceof QueryCommand
        ? Promise.resolve({
            Items: [
              {
                applicationId: scope.applicationId,
                externalAccountId: credentialTenantId,
                status: "ACTIVE",
                tenantId: scope.tenantId,
              },
            ],
          })
        : Promise.resolve({ Item: record }),
    );
    const reader = new KmsDynamoTenantOpenAICredentialReader(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: kmsSend } as unknown as KMSClient,
      {
        applicationId: scope.applicationId,
        controlTable: "control-test",
        keyId,
        tableName: "tenant-integrations-test",
      },
    );

    await expect(reader.get(scope)).rejects.toBeInstanceOf(OpenAICredentialUnavailableError);
    expect(kmsSend).not.toHaveBeenCalled();
  });

  it("rejects another application before resolving an account link", async () => {
    const dynamoSend = vi.fn();
    const reader = new KmsDynamoTenantOpenAICredentialReader(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: vi.fn() } as unknown as KMSClient,
      {
        applicationId: scope.applicationId,
        controlTable: "control-test",
        keyId,
        tableName: "tenant-integrations-test",
      },
    );

    await expect(reader.get({ ...scope, applicationId: "app_other" })).rejects.toBeInstanceOf(
      OpenAICredentialUnavailableError,
    );
    expect(dynamoSend).not.toHaveBeenCalled();
  });
});
