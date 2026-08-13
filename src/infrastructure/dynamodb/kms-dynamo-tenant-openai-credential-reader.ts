import { DecryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  OpenAICredentialUnavailableError,
  type OpenAICredential,
  type OpenAICredentialReader,
  type OpenAICredentialScope,
  type OpenAICredentialStatus,
} from "../../application/ports/openai-credential-vault.js";

const credentialRecordSchema = z.object({
  PK: z.string().min(1),
  SK: z.literal("PROVIDER#OPENAI"),
  credentialEncrypted: z.string().min(1),
  credentialLast4: z.string().length(4),
  credentialStatus: z.enum(["VALID", "INVALID", "UNKNOWN"]),
  enabled: z.literal(true),
  provider: z.literal("OPENAI"),
  tenantId: z.string().min(1),
  updatedAt: z.iso.datetime(),
});

const decryptedCredentialSchema = z.union([
  z.string().min(20),
  z.strictObject({
    apiKey: z.string().min(20),
    organization: z.string().min(1).optional(),
    project: z.string().min(1).optional(),
  }),
]);

const tenantApplicationLinkSchema = z.looseObject({
  applicationId: z.string().min(1),
  externalAccountId: z.string().min(1),
  status: z.literal("ACTIVE"),
  tenantId: z.string().min(1),
});

interface CachedCredential {
  expiresAt: number;
  value: OpenAICredential;
}

interface CachedCredentialTenantId {
  expiresAt: number;
  value: string;
}

export interface KmsDynamoTenantOpenAICredentialReaderConfig {
  cacheTtlMs?: number;
  applicationId: string;
  controlTable: string;
  keyId: string;
  tableName: string;
}

const credentialKey = (tenantId: string): { PK: string; SK: string } => ({
  PK: `TENANT#${tenantId}`,
  SK: "PROVIDER#OPENAI",
});

/** Reads the single SaaS-owned OpenAI credential for a tenant. */
export class KmsDynamoTenantOpenAICredentialReader implements OpenAICredentialReader {
  readonly #cache = new Map<string, CachedCredential>();
  readonly #applicationId: string;
  readonly #credentialTenantIdCache = new Map<string, CachedCredentialTenantId>();
  readonly #cacheTtlMs: number;
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #keyId: string;
  readonly #kms: KMSClient;
  readonly #tableName: string;

  public constructor(
    client: DynamoDBDocumentClient,
    kms: KMSClient,
    config: KmsDynamoTenantOpenAICredentialReaderConfig,
  ) {
    this.#cacheTtlMs = config.cacheTtlMs ?? 5 * 60 * 1_000;
    this.#applicationId = config.applicationId;
    this.#client = client;
    this.#controlTable = config.controlTable;
    this.#keyId = config.keyId;
    this.#kms = kms;
    this.#tableName = config.tableName;
  }

  public async get(scope: OpenAICredentialScope): Promise<OpenAICredential> {
    const credentialTenantId = await this.#credentialTenantId(scope);
    const cached = this.#cache.get(credentialTenantId);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
    if (cached !== undefined) this.#cache.delete(credentialTenantId);

    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: credentialKey(credentialTenantId),
        TableName: this.#tableName,
      }),
    );
    const parsed = credentialRecordSchema.safeParse(response.Item);
    if (
      !parsed.success ||
      parsed.data.PK !== `TENANT#${credentialTenantId}` ||
      parsed.data.tenantId !== credentialTenantId ||
      parsed.data.credentialStatus === "INVALID"
    ) {
      throw new OpenAICredentialUnavailableError();
    }

    const decrypted = await this.#kms.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(parsed.data.credentialEncrypted, "base64"),
        EncryptionContext: { provider: "OPENAI", tenantId: credentialTenantId },
        KeyId: this.#keyId,
      }),
    );
    if (decrypted.Plaintext === undefined) throw new OpenAICredentialUnavailableError();

    let value: OpenAICredential;
    try {
      const plaintext = Buffer.from(decrypted.Plaintext).toString("utf8");
      const decoded: unknown = plaintext.startsWith("{")
        ? (JSON.parse(plaintext) as unknown)
        : plaintext;
      const credential = decryptedCredentialSchema.parse(decoded);
      value =
        typeof credential === "string"
          ? { apiKey: credential }
          : {
              apiKey: credential.apiKey,
              ...(credential.organization === undefined
                ? {}
                : { organization: credential.organization }),
              ...(credential.project === undefined ? {} : { project: credential.project }),
            };
    } catch {
      throw new OpenAICredentialUnavailableError();
    }

    this.#cache.set(credentialTenantId, {
      expiresAt: Date.now() + this.#cacheTtlMs,
      value,
    });
    return value;
  }

  public async status(scope: OpenAICredentialScope): Promise<OpenAICredentialStatus> {
    const credentialTenantId = await this.#credentialTenantId(scope);
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: credentialKey(credentialTenantId),
        ProjectionExpression:
          "PK, SK, credentialLast4, credentialStatus, enabled, provider, tenantId, updatedAt",
        TableName: this.#tableName,
      }),
    );
    const parsed = credentialRecordSchema
      .omit({ credentialEncrypted: true })
      .safeParse(response.Item);
    if (!parsed.success || parsed.data.tenantId !== credentialTenantId)
      return { configured: false };
    if (parsed.data.credentialStatus === "INVALID") {
      return { configured: false, updatedAt: parsed.data.updatedAt };
    }
    return { configured: true, credentialVersion: 1, updatedAt: parsed.data.updatedAt };
  }

  public async batchStatus(
    scopes: readonly OpenAICredentialScope[],
  ): Promise<OpenAICredentialStatus[]> {
    return Promise.all(scopes.map((scope) => this.status(scope)));
  }

  async #credentialTenantId(scope: OpenAICredentialScope): Promise<string> {
    if (scope.applicationId !== this.#applicationId) {
      throw new OpenAICredentialUnavailableError();
    }
    const cacheKey = `${scope.applicationId}\u0000${scope.tenantId}`;
    const cached = this.#credentialTenantIdCache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
    if (cached !== undefined) this.#credentialTenantIdCache.delete(cacheKey);

    const response = await this.#client.send(
      new QueryCommand({
        ConsistentRead: true,
        ExpressionAttributeValues: {
          ":pk": `TENANT#${scope.tenantId}`,
          ":sk": `APP#${scope.applicationId}#ACCOUNT#`,
        },
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        Limit: 1,
        ProjectionExpression: "applicationId, externalAccountId, #status, tenantId",
        ExpressionAttributeNames: { "#status": "status" },
        TableName: this.#controlTable,
      }),
    );
    const link = tenantApplicationLinkSchema.safeParse(response.Items?.[0]);
    if (
      !link.success ||
      link.data.applicationId !== scope.applicationId ||
      link.data.tenantId !== scope.tenantId
    ) {
      throw new OpenAICredentialUnavailableError();
    }
    this.#credentialTenantIdCache.set(cacheKey, {
      expiresAt: Date.now() + this.#cacheTtlMs,
      value: link.data.externalAccountId,
    });
    return link.data.externalAccountId;
  }
}
