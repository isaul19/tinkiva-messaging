import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { KmsDynamoWhatsappEmbeddedSignupConfiguration } from "../../../src/infrastructure/dynamodb/kms-dynamo-whatsapp-embedded-signup-configuration.js";

const keyArn = "arn:aws:kms:us-east-1:123:key/test";
const context = {
  purpose: "WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET",
  stage: "test",
  tableName: "control-test",
};

describe("KmsDynamoWhatsappEmbeddedSignupConfiguration", () => {
  it("configures and decrypts one platform App Secret without persisting plaintext", async () => {
    let storedItem: Record<string, unknown> | undefined;
    const dynamoSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof GetCommand) {
        return { Item: storedItem };
      }
      if (command instanceof UpdateCommand) {
        const values = command.input.ExpressionAttributeValues as Record<string, unknown>;
        storedItem = {
          appId: values[":appId"],
          appSecretCiphertext: values[":appSecretCiphertext"],
          appSecretKeyArn: values[":appSecretKeyArn"],
          configurationId: values[":configurationId"],
          configurationVersion: values[":configurationVersion"],
          status: values[":active"],
        };
        return {};
      }
      throw new Error("Unexpected DynamoDB command.");
    });
    const kmsSend = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();
      if (command instanceof EncryptCommand) {
        expect(command.input.EncryptionContext).toEqual(context);
        return {
          CiphertextBlob: Buffer.from("platform-secret-ciphertext"),
          KeyId: keyArn,
        };
      }
      if (command instanceof DecryptCommand) {
        expect(command.input.EncryptionContext).toEqual(context);
        return {
          Plaintext: Buffer.from(
            JSON.stringify({ appSecret: "meta-platform-app-secret-for-tests" }),
          ),
        };
      }
      throw new Error("Unexpected KMS command.");
    });
    const store = new KmsDynamoWhatsappEmbeddedSignupConfiguration(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: kmsSend } as unknown as KMSClient,
      { keyArn, stage: "test", tableName: "control-test" },
    );

    await expect(store.getPublic()).resolves.toBeUndefined();
    await expect(
      store.configure({
        appId: "1393451145991555",
        appSecret: "meta-platform-app-secret-for-tests",
        configurationId: "987654321012345",
      }),
    ).resolves.toMatchObject({ configurationVersion: 1 });
    expect(JSON.stringify(storedItem)).not.toContain("meta-platform-app-secret-for-tests");
    await expect(store.getPublic()).resolves.toEqual({
      appId: "1393451145991555",
      configurationId: "987654321012345",
      configurationVersion: 1,
      status: "ACTIVE",
    });
    await expect(store.get()).resolves.toEqual({
      appId: "1393451145991555",
      appSecret: "meta-platform-app-secret-for-tests",
      configurationId: "987654321012345",
      configurationVersion: 1,
      status: "ACTIVE",
    });
  });

  it("rejects a configuration encrypted with another KMS key", async () => {
    const dynamoSend = vi.fn().mockResolvedValue({
      Item: {
        appId: "1393451145991555",
        appSecretCiphertext: "ciphertext",
        appSecretKeyArn: "arn:aws:kms:us-east-1:123:key/other",
        configurationId: "987654321012345",
        configurationVersion: 1,
        status: "ACTIVE",
      },
    });
    const store = new KmsDynamoWhatsappEmbeddedSignupConfiguration(
      { send: dynamoSend } as unknown as DynamoDBDocumentClient,
      { send: vi.fn() } as unknown as KMSClient,
      { keyArn, stage: "test", tableName: "control-test" },
    );

    await expect(store.get()).rejects.toThrow(
      "Embedded Signup configuration does not use the configured KMS key.",
    );
  });
});
