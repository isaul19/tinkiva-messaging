import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { KmsDynamoTelegramCredentialVault } from "../../../src/infrastructure/dynamodb/kms-dynamo-telegram-credential-vault.js";

describe("KmsDynamoTelegramCredentialVault", () => {
  it("persists only ciphertext, decrypts with bound context, caches, and deletes", async () => {
    let storedItem: Record<string, unknown> | undefined;
    const dynamoSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof PutCommand) {
        storedItem = command.input.Item;
        return {};
      }

      if (command instanceof GetCommand) {
        return { Item: storedItem };
      }

      if (command instanceof DeleteCommand) {
        storedItem = undefined;
        return {};
      }

      throw new Error("Unexpected DynamoDB command.");
    });
    const kmsSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof EncryptCommand) {
        expect(command.input.EncryptionContext).toEqual({
          provider: "TELEGRAM",
          providerConnectionId: "pc_test",
          stage: "test",
          tableName: "control-test",
        });
        return {
          CiphertextBlob: Buffer.from("ciphertext-only"),
          KeyId: "arn:aws:kms:us-east-1:123:key/test",
        };
      }

      if (command instanceof DecryptCommand) {
        expect(command.input.EncryptionContext).toEqual({
          provider: "TELEGRAM",
          providerConnectionId: "pc_test",
          stage: "test",
          tableName: "control-test",
        });
        return {
          Plaintext: Buffer.from(
            JSON.stringify({
              botToken: "telegram-token-for-vault-tests-123",
              webhookSecretToken: "webhook-secret-for-vault-tests-1234567890",
            }),
          ),
        };
      }

      throw new Error("Unexpected KMS command.");
    });
    const vault = new KmsDynamoTelegramCredentialVault(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: kmsSend } as unknown as KMSClient,
      {
        cacheTtlMs: 60_000,
        keyArn: "arn:aws:kms:us-east-1:123:key/test",
        stage: "test",
        tableName: "control-test",
      },
    );

    await expect(
      vault.create({
        applicationId: "app_test",
        botToken: "telegram-token-for-vault-tests-123",
        providerConnectionId: "pc_test",
        tenantId: "tenant_test",
        webhookSecretToken: "webhook-secret-for-vault-tests-1234567890",
      }),
    ).resolves.toBe("pc_test");
    expect(storedItem).toMatchObject({
      credentialCiphertext: Buffer.from("ciphertext-only").toString("base64"),
      credentialVersion: 1,
      entityType: "PROVIDER_CREDENTIAL",
    });
    expect(JSON.stringify(storedItem)).not.toContain("telegram-token-for-vault-tests-123");
    expect(JSON.stringify(storedItem)).not.toContain("webhook-secret-for-vault-tests-1234567890");

    await expect(vault.get("pc_test")).resolves.toEqual({
      botToken: "telegram-token-for-vault-tests-123",
      webhookSecretToken: "webhook-secret-for-vault-tests-1234567890",
    });
    await vault.get("pc_test");
    expect(kmsSend).toHaveBeenCalledTimes(2);

    await vault.deleteImmediately("pc_test");
    expect(storedItem).toBeUndefined();
  });
});
