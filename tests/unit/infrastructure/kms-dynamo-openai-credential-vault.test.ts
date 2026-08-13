import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import {
  OpenAICredentialUnavailableError,
  OpenAICredentialVersionConflictError,
} from "../../../src/application/ports/openai-credential-vault.js";
import { KmsDynamoOpenAICredentialVault } from "../../../src/infrastructure/dynamodb/kms-dynamo-openai-credential-vault.js";

const keyArn = "arn:aws:kms:us-east-1:123456789012:key/test";
const scope = {
  applicationId: "app_test",
  integrationId: "int_test",
  tenantId: "tenant_test",
};
const updatedAt = "2026-08-12T12:00:00.000Z";
const credential = {
  apiKey: "sk-project-key-for-openai-vault-tests",
  organization: "org_test",
  project: "proj_test",
};

const record = (credentialVersion = 1) => ({
  ...scope,
  credentialCiphertext: Buffer.from(`cipher-${String(credentialVersion)}`).toString("base64"),
  credentialKeyArn: keyArn,
  credentialVersion,
  entityType: "OPENAI_CREDENTIAL",
  updatedAt,
});

const createVault = (
  dynamoSend: ReturnType<typeof vi.fn>,
  kmsSend: ReturnType<typeof vi.fn> = vi.fn(),
) =>
  new KmsDynamoOpenAICredentialVault(
    { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    { send: kmsSend } as unknown as KMSClient,
    {
      cacheTtlMs: 60_000,
      keyArn,
      stage: "test",
      tableName: "control-test",
    },
  );

describe("KmsDynamoOpenAICredentialVault", () => {
  it("decrypts an owned credential with a strong encryption context and version-aware cache", async () => {
    let credentialVersion = 1;
    let plaintext = credential;
    const dynamoSend = vi.fn((command: unknown): Promise<unknown> => {
      expect(command).toBeInstanceOf(GetCommand);
      return Promise.resolve({ Item: record(credentialVersion) });
    });
    const kmsSend = vi.fn((command: unknown): Promise<unknown> => {
      expect(command).toBeInstanceOf(DecryptCommand);
      expect((command as DecryptCommand).input).toMatchObject({
        EncryptionContext: {
          ...scope,
          resourceType: "OPENAI_CREDENTIAL",
          stage: "test",
          tableName: "control-test",
        },
        KeyId: keyArn,
      });
      return Promise.resolve({ Plaintext: Buffer.from(JSON.stringify(plaintext)) });
    });
    const vault = createVault(dynamoSend, kmsSend);

    await expect(vault.get(scope)).resolves.toEqual(credential);
    await expect(vault.get(scope)).resolves.toEqual(credential);
    expect(kmsSend).toHaveBeenCalledTimes(1);

    credentialVersion = 2;
    plaintext = { ...credential, apiKey: "sk-rotated-project-key-for-vault-tests" };
    await expect(vault.get(scope)).resolves.toEqual(plaintext);
    expect(kmsSend).toHaveBeenCalledTimes(2);
    expect(dynamoSend).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["missing", undefined],
    ["another tenant", { ...record(), tenantId: "tenant_other" }],
    ["another KMS key", { ...record(), credentialKeyArn: `${keyArn}-other` }],
  ])("rejects %s metadata without attempting decryption", async (_label, item) => {
    const kmsSend = vi.fn();
    const vault = createVault(vi.fn().mockResolvedValue({ Item: item }), kmsSend);

    await expect(vault.get(scope)).rejects.toBeInstanceOf(OpenAICredentialUnavailableError);
    expect(kmsSend).not.toHaveBeenCalled();
  });

  it("returns credential status without decrypting or exposing ciphertext", async () => {
    const kmsSend = vi.fn();
    const vault = createVault(vi.fn().mockResolvedValue({ Item: record(3) }), kmsSend);

    await expect(vault.status(scope)).resolves.toEqual({
      configured: true,
      credentialVersion: 3,
      updatedAt,
    });
    expect(kmsSend).not.toHaveBeenCalled();
  });

  it("creates then rotates ciphertext using optimistic credential versions", async () => {
    const writes: TransactWriteCommand[] = [];
    const dynamoSend = vi.fn((command: unknown): Promise<unknown> => {
      expect(command).toBeInstanceOf(TransactWriteCommand);
      writes.push(command as TransactWriteCommand);
      return Promise.resolve({});
    });
    const kmsSend = vi.fn((command: unknown): Promise<unknown> => {
      expect(command).toBeInstanceOf(EncryptCommand);
      return Promise.resolve({ CiphertextBlob: Buffer.from("ciphertext"), KeyId: keyArn });
    });
    const vault = createVault(dynamoSend, kmsSend);

    await expect(vault.upsert({ ...scope, ...credential })).resolves.toMatchObject({
      configured: true,
      credentialVersion: 1,
    });
    await expect(
      vault.upsert({ ...scope, ...credential, expectedCredentialVersion: 1 }),
    ).resolves.toMatchObject({ configured: true, credentialVersion: 2 });

    const create = writes[0]?.input.TransactItems?.[0]?.Put;
    expect(create?.ConditionExpression).toBe(
      "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    );
    expect(create?.Item).toEqual(
      expect.objectContaining({
        PK: "INTEGRATION#int_test",
        SK: "OPENAI_CREDENTIAL",
        ...scope,
        credentialVersion: 1,
        entityType: "OPENAI_CREDENTIAL",
      }),
    );
    expect(
      Object.keys(create?.Item ?? {}).filter((attribute) => attribute.startsWith(":")),
    ).toEqual([]);
    expect(writes[1]?.input.TransactItems?.[0]?.Update?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":credentialVersion": 2,
        ":expectedCredentialVersion": 1,
      }),
    );
    expect(writes[1]?.input.TransactItems?.[1]?.Update?.Key).toEqual({
      PK: "INTEGRATION#int_test",
      SK: "META",
    });
  });

  it("maps a stale credential write to a version conflict", async () => {
    const dynamoSend = vi.fn().mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
        message: "stale",
      }),
    );
    const kmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from("ciphertext"),
      KeyId: keyArn,
    });

    await expect(
      createVault(dynamoSend, kmsSend).upsert({
        ...scope,
        ...credential,
        expectedCredentialVersion: 4,
      }),
    ).rejects.toBeInstanceOf(OpenAICredentialVersionConflictError);
  });

  it("does not disclose an integration ownership failure as a version conflict", async () => {
    const dynamoSend = vi.fn().mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
        message: "wrong owner",
      }),
    );
    const kmsSend = vi.fn().mockResolvedValue({
      CiphertextBlob: Buffer.from("ciphertext"),
      KeyId: keyArn,
    });

    await expect(
      createVault(dynamoSend, kmsSend).upsert({ ...scope, ...credential }),
    ).rejects.toBeInstanceOf(OpenAICredentialUnavailableError);
  });

  it("deletes only the expected owned version and disables both enrichment flags", async () => {
    let write: TransactWriteCommand | undefined;
    const vault = createVault(
      vi.fn((command: unknown): Promise<unknown> => {
        write = command as TransactWriteCommand;
        return Promise.resolve({});
      }),
    );

    await expect(vault.delete({ ...scope, expectedCredentialVersion: 3 })).resolves.toEqual({
      configured: false,
    });
    const credentialDelete = write?.input.TransactItems?.[0]?.Delete;
    expect(credentialDelete?.ConditionExpression).toBe(
      "applicationId = :applicationId AND tenantId = :tenantId AND " +
        "integrationId = :integrationId AND entityType = :credentialEntityType" +
        " AND credentialKeyArn = :configuredKeyArn" +
        " AND credentialVersion = :expectedCredentialVersion",
    );
    expect(credentialDelete?.ExpressionAttributeValues).toEqual({
      ":applicationId": scope.applicationId,
      ":configuredKeyArn": keyArn,
      ":credentialEntityType": "OPENAI_CREDENTIAL",
      ":expectedCredentialVersion": 3,
      ":integrationId": scope.integrationId,
      ":tenantId": scope.tenantId,
    });
    const integrationUpdate = write?.input.TransactItems?.[1]?.Update;
    expect(integrationUpdate?.UpdateExpression).toBe(
      "SET inboundMedia = :disabledInboundMedia, updatedAt = :updatedAt REMOVE openAiCredential",
    );
    expect(integrationUpdate?.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":disabledInboundMedia": {
          audioAlternativeText: false,
          imageAlternativeText: false,
        },
      }),
    );
  });
});
