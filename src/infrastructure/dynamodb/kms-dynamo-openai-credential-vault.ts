import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchGetCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  OpenAICredentialUnavailableError,
  OpenAICredentialVersionConflictError,
  type DeleteOpenAICredentialInput,
  type OpenAICredential,
  type OpenAICredentialScope,
  type OpenAICredentialStatus,
  type OpenAICredentialVault,
  type UpsertOpenAICredentialInput,
} from "../../application/ports/openai-credential-vault.js";

const openAICredentialSchema = z.strictObject({
  apiKey: z.string().min(20),
  organization: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
});

const credentialMetadataSchema = z.object({
  applicationId: z.string().min(1),
  credentialKeyArn: z.string().min(1),
  credentialVersion: z.number().int().positive(),
  entityType: z.literal("OPENAI_CREDENTIAL"),
  integrationId: z.string().min(1),
  tenantId: z.string().min(1),
  updatedAt: z.iso.datetime(),
});

const credentialRecordSchema = credentialMetadataSchema.extend({
  credentialCiphertext: z.string().min(1),
});

export interface KmsDynamoOpenAICredentialVaultConfig {
  cacheTtlMs?: number;
  keyArn: string;
  stage: string;
  tableName: string;
}

interface CachedCredential {
  credentialVersion: number;
  expiresAt: number;
  value: OpenAICredential;
}

const credentialKey = (integrationId: string): { PK: string; SK: string } => ({
  PK: `INTEGRATION#${integrationId}`,
  SK: "OPENAI_CREDENTIAL",
});

export class KmsDynamoOpenAICredentialVault implements OpenAICredentialVault {
  readonly #cache = new Map<string, CachedCredential>();
  readonly #cacheTtlMs: number;
  readonly #client: DynamoDBDocumentClient;
  readonly #keyArn: string;
  readonly #kms: KMSClient;
  readonly #stage: string;
  readonly #tableName: string;

  public constructor(
    client: DynamoDBDocumentClient,
    kms: KMSClient,
    config: KmsDynamoOpenAICredentialVaultConfig,
  ) {
    this.#cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1_000;
    this.#client = client;
    this.#keyArn = config.keyArn;
    this.#kms = kms;
    this.#stage = config.stage;
    this.#tableName = config.tableName;
  }

  public async get(scope: OpenAICredentialScope): Promise<OpenAICredential> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: credentialKey(scope.integrationId),
        TableName: this.#tableName,
      }),
    );
    const record = this.#ownedRecord(response.Item, scope);
    const cacheKey = this.#cacheKey(scope);
    const cached = this.#cache.get(cacheKey);

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
        EncryptionContext: this.#encryptionContext(scope),
        KeyId: this.#keyArn,
      }),
    );

    if (decrypted.Plaintext === undefined) throw new OpenAICredentialUnavailableError();

    let credential: OpenAICredential;
    try {
      const parsed = openAICredentialSchema.parse(
        JSON.parse(Buffer.from(decrypted.Plaintext).toString("utf8")) as unknown,
      );
      credential = {
        apiKey: parsed.apiKey,
        ...(parsed.organization === undefined ? {} : { organization: parsed.organization }),
        ...(parsed.project === undefined ? {} : { project: parsed.project }),
      };
    } catch {
      throw new OpenAICredentialUnavailableError();
    }

    this.#cache.set(cacheKey, {
      credentialVersion: record.credentialVersion,
      expiresAt: Date.now() + this.#cacheTtlMs,
      value: credential,
    });
    return credential;
  }

  public async status(scope: OpenAICredentialScope): Promise<OpenAICredentialStatus> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: credentialKey(scope.integrationId),
        ProjectionExpression:
          "applicationId, credentialKeyArn, credentialVersion, entityType, integrationId, tenantId, updatedAt",
        TableName: this.#tableName,
      }),
    );
    if (response.Item === undefined) return { configured: false };
    const record = this.#ownedMetadata(response.Item, scope);
    return this.#status(record);
  }

  public async batchStatus(
    scopes: readonly OpenAICredentialScope[],
  ): Promise<OpenAICredentialStatus[]> {
    const statuses = new Map<string, OpenAICredentialStatus>();

    for (let offset = 0; offset < scopes.length; offset += 100) {
      const chunk = scopes.slice(offset, offset + 100);
      const response = await this.#client.send(
        new BatchGetCommand({
          RequestItems: {
            [this.#tableName]: {
              ConsistentRead: true,
              Keys: chunk.map((scope) => credentialKey(scope.integrationId)),
              ProjectionExpression:
                "applicationId, credentialKeyArn, credentialVersion, entityType, integrationId, tenantId, updatedAt",
            },
          },
        }),
      );
      if ((response.UnprocessedKeys?.[this.#tableName]?.Keys?.length ?? 0) > 0) {
        throw new Error("OpenAI credential status read was incomplete.");
      }
      const chunkByIntegration = new Map(chunk.map((scope) => [scope.integrationId, scope]));
      for (const item of response.Responses?.[this.#tableName] ?? []) {
        const integrationId = typeof item.integrationId === "string" ? item.integrationId : "";
        const scope = chunkByIntegration.get(integrationId);
        if (scope === undefined) throw new OpenAICredentialUnavailableError();
        statuses.set(this.#cacheKey(scope), this.#status(this.#ownedMetadata(item, scope)));
      }
    }

    return scopes.map((scope) => statuses.get(this.#cacheKey(scope)) ?? { configured: false });
  }

  public async upsert(input: UpsertOpenAICredentialInput): Promise<OpenAICredentialStatus> {
    const credential = openAICredentialSchema.parse({
      apiKey: input.apiKey,
      ...(input.organization === undefined ? {} : { organization: input.organization }),
      ...(input.project === undefined ? {} : { project: input.project }),
    });
    const encrypted = await this.#kms.send(
      new EncryptCommand({
        EncryptionContext: this.#encryptionContext(input),
        KeyId: this.#keyArn,
        Plaintext: Buffer.from(JSON.stringify(credential), "utf8"),
      }),
    );
    if (encrypted.CiphertextBlob === undefined || encrypted.KeyId === undefined) {
      throw new Error("KMS returned no OpenAI credential ciphertext.");
    }

    const credentialVersion = (input.expectedCredentialVersion ?? 0) + 1;
    const updatedAt = new Date().toISOString();
    const status: OpenAICredentialStatus = { configured: true, credentialVersion, updatedAt };
    const ownershipExpressionValues = this.#ownershipExpressionValues(input);
    const credentialItem = {
      ...credentialKey(input.integrationId),
      ...this.#ownership(input),
      credentialCiphertext: Buffer.from(encrypted.CiphertextBlob).toString("base64"),
      credentialKeyArn: encrypted.KeyId,
      credentialVersion,
      createdAt: updatedAt,
      entityType: "OPENAI_CREDENTIAL",
      updatedAt,
    };

    const credentialWrite =
      input.expectedCredentialVersion === undefined
        ? {
            Put: {
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              Item: credentialItem,
              TableName: this.#tableName,
            },
          }
        : {
            Update: {
              ConditionExpression:
                "applicationId = :applicationId AND tenantId = :tenantId AND " +
                "integrationId = :integrationId AND entityType = :credentialEntityType AND " +
                "credentialKeyArn = :configuredKeyArn AND " +
                "credentialVersion = :expectedCredentialVersion",
              ExpressionAttributeValues: {
                ...ownershipExpressionValues,
                ":credentialCiphertext": credentialItem.credentialCiphertext,
                ":credentialEntityType": "OPENAI_CREDENTIAL",
                ":credentialKeyArn": encrypted.KeyId,
                ":configuredKeyArn": this.#keyArn,
                ":credentialVersion": credentialVersion,
                ":expectedCredentialVersion": input.expectedCredentialVersion,
                ":updatedAt": updatedAt,
              },
              Key: credentialKey(input.integrationId),
              TableName: this.#tableName,
              UpdateExpression:
                "SET credentialCiphertext = :credentialCiphertext, " +
                "credentialKeyArn = :credentialKeyArn, credentialVersion = :credentialVersion, " +
                "updatedAt = :updatedAt",
            },
          };

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            credentialWrite,
            {
              Update: {
                ConditionExpression:
                  "applicationId = :applicationId AND tenantId = :tenantId AND " +
                  "integrationId = :integrationId AND entityType = :integrationEntityType",
                ExpressionAttributeValues: {
                  ...ownershipExpressionValues,
                  ":integrationEntityType": "CHANNEL_INTEGRATION",
                  ":openAiCredential": status,
                  ":updatedAt": updatedAt,
                },
                Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
                TableName: this.#tableName,
                UpdateExpression:
                  "SET openAiCredential = :openAiCredential, updatedAt = :updatedAt",
              },
            },
          ],
        }),
      );
    } catch (error) {
      throwMappedTransactionError(error);
      throw error;
    }

    this.#cache.delete(this.#cacheKey(input));
    return status;
  }

  public async delete(input: DeleteOpenAICredentialInput): Promise<OpenAICredentialStatus> {
    const ownershipExpressionValues = this.#ownershipExpressionValues(input);
    const updatedAt = new Date().toISOString();

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                ConditionExpression:
                  "applicationId = :applicationId AND tenantId = :tenantId AND " +
                  "integrationId = :integrationId AND entityType = :credentialEntityType" +
                  " AND credentialKeyArn = :configuredKeyArn" +
                  " AND credentialVersion = :expectedCredentialVersion",
                ExpressionAttributeValues: {
                  ...ownershipExpressionValues,
                  ":credentialEntityType": "OPENAI_CREDENTIAL",
                  ":configuredKeyArn": this.#keyArn,
                  ":expectedCredentialVersion": input.expectedCredentialVersion,
                },
                Key: credentialKey(input.integrationId),
                TableName: this.#tableName,
              },
            },
            {
              Update: {
                ConditionExpression:
                  "applicationId = :applicationId AND tenantId = :tenantId AND " +
                  "integrationId = :integrationId AND entityType = :integrationEntityType",
                ExpressionAttributeValues: {
                  ...ownershipExpressionValues,
                  ":disabledInboundMedia": {
                    audioAlternativeText: false,
                    imageAlternativeText: false,
                  },
                  ":integrationEntityType": "CHANNEL_INTEGRATION",
                  ":updatedAt": updatedAt,
                },
                Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
                TableName: this.#tableName,
                UpdateExpression:
                  "SET inboundMedia = :disabledInboundMedia, updatedAt = :updatedAt " +
                  "REMOVE openAiCredential",
              },
            },
          ],
        }),
      );
    } catch (error) {
      throwMappedTransactionError(error);
      throw error;
    }

    this.#cache.delete(this.#cacheKey(input));
    return { configured: false };
  }

  #ownedRecord(
    item: unknown,
    scope: OpenAICredentialScope,
  ): z.infer<typeof credentialRecordSchema> {
    const parsed = credentialRecordSchema.safeParse(item);
    if (
      !parsed.success ||
      parsed.data.applicationId !== scope.applicationId ||
      parsed.data.tenantId !== scope.tenantId ||
      parsed.data.integrationId !== scope.integrationId ||
      parsed.data.credentialKeyArn !== this.#keyArn
    ) {
      throw new OpenAICredentialUnavailableError();
    }
    return parsed.data;
  }

  #ownedMetadata(
    item: unknown,
    scope: OpenAICredentialScope,
  ): z.infer<typeof credentialMetadataSchema> {
    const parsed = credentialMetadataSchema.safeParse(item);
    if (
      !parsed.success ||
      parsed.data.applicationId !== scope.applicationId ||
      parsed.data.tenantId !== scope.tenantId ||
      parsed.data.integrationId !== scope.integrationId ||
      parsed.data.credentialKeyArn !== this.#keyArn
    ) {
      throw new OpenAICredentialUnavailableError();
    }
    return parsed.data;
  }

  #status(record: z.infer<typeof credentialMetadataSchema>): OpenAICredentialStatus {
    return {
      configured: true,
      credentialVersion: record.credentialVersion,
      updatedAt: record.updatedAt,
    };
  }

  #cacheKey(scope: OpenAICredentialScope): string {
    return `${scope.applicationId}\u0000${scope.tenantId}\u0000${scope.integrationId}`;
  }

  #encryptionContext(scope: OpenAICredentialScope): Record<string, string> {
    return {
      applicationId: scope.applicationId,
      integrationId: scope.integrationId,
      resourceType: "OPENAI_CREDENTIAL",
      stage: this.#stage,
      tableName: this.#tableName,
      tenantId: scope.tenantId,
    };
  }

  #ownership(scope: OpenAICredentialScope): OpenAICredentialScope {
    return {
      applicationId: scope.applicationId,
      integrationId: scope.integrationId,
      tenantId: scope.tenantId,
    };
  }

  #ownershipExpressionValues(scope: OpenAICredentialScope): Record<string, string> {
    return {
      ":applicationId": scope.applicationId,
      ":integrationId": scope.integrationId,
      ":tenantId": scope.tenantId,
    };
  }
}

const throwMappedTransactionError = (error: unknown): void => {
  if (!(error instanceof TransactionCanceledException)) return;
  const reasons = error.CancellationReasons ?? [];

  // The second operation always owns the integration META item. Treat an ownership failure
  // as unavailable so a caller cannot infer whether another tenant configured a credential.
  if (reasons[1]?.Code === "ConditionalCheckFailed") {
    throw new OpenAICredentialUnavailableError();
  }
  if (reasons[0]?.Code === "ConditionalCheckFailed") {
    throw new OpenAICredentialVersionConflictError();
  }
  if (reasons.some((reason) => reason.Code === "ConditionalCheckFailed")) {
    throw new OpenAICredentialUnavailableError();
  }
};
