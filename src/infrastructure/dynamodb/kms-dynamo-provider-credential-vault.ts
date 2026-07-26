import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { ProviderCredentialVersionConflictError } from "../../application/ports/provider-credential-vault-errors.js";

const credentialRecordSchema = z.object({
  applicationId: z.string().min(1),
  credentialCiphertext: z.string().min(1),
  credentialKeyArn: z.string().min(1),
  credentialVersion: z.number().int().positive(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerConnectionId: z.string().min(1),
  tenantId: z.string().min(1),
});

export interface ProviderCredentialVaultConfig<TCredential> {
  cacheTtlMs?: number;
  keyArn: string;
  provider: "TELEGRAM" | "WHATSAPP";
  schema: z.ZodType<TCredential>;
  stage: string;
  tableName: string;
}

export interface CreateProviderCredentialInput<TCredential> {
  applicationId: string;
  credential: TCredential;
  providerConnectionId: string;
  tenantId: string;
}

export interface RotateProviderCredentialInput<
  TCredential,
> extends CreateProviderCredentialInput<TCredential> {
  expectedCredentialVersion: number;
}

export interface RotateProviderCredentialResult {
  credentialVersion: number;
  updatedAt: string;
}

export class KmsDynamoProviderCredentialVault<TCredential> {
  readonly #cache = new Map<
    string,
    { credentialVersion: number; expiresAt: number; value: TCredential }
  >();
  readonly #cacheTtlMs: number;
  readonly #client: DynamoDBDocumentClient;
  readonly #keyArn: string;
  readonly #kms: KMSClient;
  readonly #provider: "TELEGRAM" | "WHATSAPP";
  readonly #schema: z.ZodType<TCredential>;
  readonly #stage: string;
  readonly #tableName: string;

  public constructor(
    client: DynamoDBDocumentClient,
    kms: KMSClient,
    config: ProviderCredentialVaultConfig<TCredential>,
  ) {
    this.#cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1_000;
    this.#client = client;
    this.#keyArn = config.keyArn;
    this.#kms = kms;
    this.#provider = config.provider;
    this.#schema = config.schema;
    this.#stage = config.stage;
    this.#tableName = config.tableName;
  }

  public async create(input: CreateProviderCredentialInput<TCredential>): Promise<string> {
    const credentialRef = input.providerConnectionId;
    const encrypted = await this.#kms.send(
      new EncryptCommand({
        EncryptionContext: this.#encryptionContext(credentialRef),
        KeyId: this.#keyArn,
        Plaintext: Buffer.from(JSON.stringify(input.credential), "utf8"),
      }),
    );

    if (encrypted.CiphertextBlob === undefined || encrypted.KeyId === undefined) {
      throw new Error("KMS returned no provider credential ciphertext.");
    }

    const timestamp = new Date().toISOString();
    await this.#client.send(
      new PutCommand({
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        Item: {
          PK: `PROVIDER_CONNECTION#${credentialRef}`,
          SK: "CREDENTIAL",
          applicationId: input.applicationId,
          credentialCiphertext: Buffer.from(encrypted.CiphertextBlob).toString("base64"),
          credentialKeyArn: encrypted.KeyId,
          credentialVersion: 1,
          createdAt: timestamp,
          entityType: "PROVIDER_CREDENTIAL",
          provider: this.#provider,
          providerConnectionId: credentialRef,
          tenantId: input.tenantId,
          updatedAt: timestamp,
        },
        TableName: this.#tableName,
      }),
    );

    return credentialRef;
  }

  public async get(credentialRef: string): Promise<TCredential> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `PROVIDER_CONNECTION#${credentialRef}`,
          SK: "CREDENTIAL",
        },
        TableName: this.#tableName,
      }),
    );
    const record = credentialRecordSchema.parse(response.Item);

    if (
      record.provider !== this.#provider ||
      record.providerConnectionId !== credentialRef ||
      record.credentialKeyArn !== this.#keyArn
    ) {
      throw new Error("Provider credential metadata does not match the configured vault.");
    }

    const cached = this.#cache.get(credentialRef);

    if (
      cached !== undefined &&
      cached.expiresAt > Date.now() &&
      cached.credentialVersion === record.credentialVersion
    ) {
      return cached.value;
    }

    const decrypted = await this.#kms.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(record.credentialCiphertext, "base64"),
        EncryptionContext: this.#encryptionContext(credentialRef),
        KeyId: this.#keyArn,
      }),
    );

    if (decrypted.Plaintext === undefined) {
      throw new Error("KMS returned no provider credential plaintext.");
    }

    const credential = this.#schema.parse(
      JSON.parse(Buffer.from(decrypted.Plaintext).toString("utf8")) as unknown,
    );
    this.#cache.set(credentialRef, {
      credentialVersion: record.credentialVersion,
      expiresAt: Date.now() + this.#cacheTtlMs,
      value: credential,
    });

    return credential;
  }

  public async rotate(
    input: RotateProviderCredentialInput<TCredential>,
  ): Promise<RotateProviderCredentialResult> {
    const credentialRef = input.providerConnectionId;
    const encrypted = await this.#kms.send(
      new EncryptCommand({
        EncryptionContext: this.#encryptionContext(credentialRef),
        KeyId: this.#keyArn,
        Plaintext: Buffer.from(JSON.stringify(input.credential), "utf8"),
      }),
    );

    if (encrypted.CiphertextBlob === undefined || encrypted.KeyId === undefined) {
      throw new Error("KMS returned no provider credential ciphertext.");
    }

    const credentialVersion = input.expectedCredentialVersion + 1;
    const updatedAt = new Date().toISOString();

    try {
      await this.#client.send(
        new UpdateCommand({
          ConditionExpression:
            "applicationId = :applicationId AND tenantId = :tenantId AND #provider = :provider " +
            "AND providerConnectionId = :providerConnectionId " +
            "AND credentialVersion = :expectedCredentialVersion",
          ExpressionAttributeNames: {
            "#provider": "provider",
          },
          ExpressionAttributeValues: {
            ":applicationId": input.applicationId,
            ":credentialCiphertext": Buffer.from(encrypted.CiphertextBlob).toString("base64"),
            ":credentialKeyArn": encrypted.KeyId,
            ":credentialVersion": credentialVersion,
            ":expectedCredentialVersion": input.expectedCredentialVersion,
            ":provider": this.#provider,
            ":providerConnectionId": credentialRef,
            ":tenantId": input.tenantId,
            ":updatedAt": updatedAt,
          },
          Key: {
            PK: `PROVIDER_CONNECTION#${credentialRef}`,
            SK: "CREDENTIAL",
          },
          TableName: this.#tableName,
          UpdateExpression:
            "SET credentialCiphertext = :credentialCiphertext, " +
            "credentialKeyArn = :credentialKeyArn, credentialVersion = :credentialVersion, " +
            "updatedAt = :updatedAt",
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new ProviderCredentialVersionConflictError();
      }

      throw error;
    }

    this.#cache.delete(credentialRef);

    return {
      credentialVersion,
      updatedAt,
    };
  }

  public async deleteImmediately(credentialRef: string): Promise<void> {
    this.#cache.delete(credentialRef);
    await this.#client.send(
      new DeleteCommand({
        Key: {
          PK: `PROVIDER_CONNECTION#${credentialRef}`,
          SK: "CREDENTIAL",
        },
        TableName: this.#tableName,
      }),
    );
  }

  #encryptionContext(providerConnectionId: string): Record<string, string> {
    return {
      provider: this.#provider,
      providerConnectionId,
      stage: this.#stage,
      tableName: this.#tableName,
    };
  }
}
