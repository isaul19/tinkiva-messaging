import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  CreateTelegramCredentialInput,
  TelegramCredential,
  TelegramCredentialVault,
} from "../../application/ports/telegram-credential-vault.js";
import { telegramSecretSchema } from "../../contracts/providers/telegram.contract.js";

const credentialRecordSchema = z.object({
  credentialCiphertext: z.string().min(1),
  credentialKeyArn: z.string().min(1),
  credentialVersion: z.number().int().positive(),
  provider: z.literal("TELEGRAM"),
  providerConnectionId: z.string().min(1),
});

export interface KmsDynamoTelegramCredentialVaultConfig {
  cacheTtlMs?: number;
  keyArn: string;
  stage: string;
  tableName: string;
}

export class KmsDynamoTelegramCredentialVault implements TelegramCredentialVault {
  readonly #cache = new Map<string, { expiresAt: number; value: TelegramCredential }>();
  readonly #cacheTtlMs: number;
  readonly #client: DynamoDBDocumentClient;
  readonly #keyArn: string;
  readonly #kms: KMSClient;
  readonly #stage: string;
  readonly #tableName: string;

  public constructor(
    client: DynamoDBDocumentClient,
    kms: KMSClient,
    config: KmsDynamoTelegramCredentialVaultConfig,
  ) {
    this.#cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1_000;
    this.#client = client;
    this.#keyArn = config.keyArn;
    this.#kms = kms;
    this.#stage = config.stage;
    this.#tableName = config.tableName;
  }

  public async create(input: CreateTelegramCredentialInput): Promise<string> {
    const credentialRef = input.providerConnectionId;
    const encryptionContext = this.#encryptionContext(credentialRef);
    const encrypted = await this.#kms.send(
      new EncryptCommand({
        EncryptionContext: encryptionContext,
        KeyId: this.#keyArn,
        Plaintext: Buffer.from(
          JSON.stringify({
            botToken: input.botToken,
            webhookSecretToken: input.webhookSecretToken,
          }),
          "utf8",
        ),
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
          provider: "TELEGRAM",
          providerConnectionId: credentialRef,
          tenantId: input.tenantId,
          updatedAt: timestamp,
        },
        TableName: this.#tableName,
      }),
    );

    return credentialRef;
  }

  public async get(credentialRef: string): Promise<TelegramCredential> {
    const cached = this.#cache.get(credentialRef);

    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.value;
    }

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

    const credential = telegramSecretSchema.parse(
      JSON.parse(Buffer.from(decrypted.Plaintext).toString("utf8")) as unknown,
    );
    this.#cache.set(credentialRef, {
      expiresAt: Date.now() + this.#cacheTtlMs,
      value: credential,
    });

    return credential;
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
      provider: "TELEGRAM",
      providerConnectionId,
      stage: this.#stage,
      tableName: this.#tableName,
    };
  }
}
