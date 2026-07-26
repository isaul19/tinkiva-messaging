import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { ProviderCredentialVersionConflictError } from "../../../src/application/ports/provider-credential-vault-errors.js";
import { KmsDynamoWhatsappCredentialVault } from "../../../src/infrastructure/dynamodb/kms-dynamo-whatsapp-credential-vault.js";

const keyArn = "arn:aws:kms:us-east-1:123:key/test";
const originalCredential = {
  accessToken: "old-whatsapp-token-for-vault-tests",
  appSecret: "meta-app-secret-for-vault-tests",
  verifyToken: "verify-token-for-vault-tests-1234567890",
};
const rotatedCredential = {
  ...originalCredential,
  accessToken: "new-whatsapp-token-for-vault-tests",
};

describe("KmsDynamoWhatsappCredentialVault rotation", () => {
  it("updates ciphertext conditionally and invalidates the decrypted cache", async () => {
    let credentialVersion = 1;
    let plaintext = originalCredential;
    const dynamoSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof GetCommand) {
        return {
          Item: {
            applicationId: "app_test",
            credentialCiphertext: Buffer.from(`cipher-${String(credentialVersion)}`).toString(
              "base64",
            ),
            credentialKeyArn: keyArn,
            credentialVersion,
            provider: "WHATSAPP",
            providerConnectionId: "pc_test",
            tenantId: "tenant_test",
          },
        };
      }

      if (command instanceof UpdateCommand) {
        expect(command.input.ExpressionAttributeValues).toMatchObject({
          ":expectedCredentialVersion": 1,
          ":credentialVersion": 2,
        });
        credentialVersion = 2;
        plaintext = rotatedCredential;
        return {};
      }

      throw new Error("Unexpected DynamoDB command.");
    });
    const kmsSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof DecryptCommand) {
        return { Plaintext: Buffer.from(JSON.stringify(plaintext)) };
      }
      if (command instanceof EncryptCommand) {
        return { CiphertextBlob: Buffer.from("rotated-ciphertext"), KeyId: keyArn };
      }
      throw new Error("Unexpected KMS command.");
    });
    const vault = new KmsDynamoWhatsappCredentialVault(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: kmsSend } as unknown as KMSClient,
      { cacheTtlMs: 60_000, keyArn, stage: "test", tableName: "control-test" },
    );

    await expect(vault.get("pc_test")).resolves.toEqual(originalCredential);
    await expect(
      vault.rotate({
        ...rotatedCredential,
        applicationId: "app_test",
        expectedCredentialVersion: 1,
        providerConnectionId: "pc_test",
        tenantId: "tenant_test",
      }),
    ).resolves.toMatchObject({ credentialVersion: 2 });
    await expect(vault.get("pc_test")).resolves.toEqual(rotatedCredential);
    expect(kmsSend).toHaveBeenCalledTimes(3);
  });

  it("maps a conditional write failure to a version conflict", async () => {
    const dynamoSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof UpdateCommand) {
        throw new ConditionalCheckFailedException({
          $metadata: {},
          message: "stale version",
        });
      }
      throw new Error("Unexpected DynamoDB command.");
    });
    const kmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from("rotated-ciphertext"),
      KeyId: keyArn,
    });
    const vault = new KmsDynamoWhatsappCredentialVault(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: kmsSend } as unknown as KMSClient,
      { keyArn, stage: "test", tableName: "control-test" },
    );

    await expect(
      vault.rotate({
        ...rotatedCredential,
        applicationId: "app_test",
        expectedCredentialVersion: 1,
        providerConnectionId: "pc_test",
        tenantId: "tenant_test",
      }),
    ).rejects.toBeInstanceOf(ProviderCredentialVersionConflictError);
  });
});
