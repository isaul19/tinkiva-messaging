import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  TenantStoreConflictError,
  type AppTenantLinkRecord,
  type CreateTenantRecordsInput,
  type IdempotencyRecord,
  type TenantRecord,
  type TenantStore,
} from "../../application/ports/tenant-store.js";

const tenantSchema = z.looseObject({
  createdAt: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  tenantId: z.string().min(1),
});

const linkSchema = z.looseObject({
  applicationId: z.string().min(1),
  externalAccountId: z.string().min(1),
  requestHash: z.string().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  tenantId: z.string().min(1),
});

const idempotencySchema = z.looseObject({
  requestHash: z.string().min(1),
  resourceId: z.string().min(1),
  status: z.literal("COMPLETED"),
});

export class DynamoTenantStore implements TenantStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async createTenantRecords(input: CreateTenantRecordsInput): Promise<void> {
    const tenantItem = {
      PK: `TENANT#${input.tenantId}`,
      SK: "META",
      createdAt: input.now,
      entityType: "TENANT",
      name: input.name,
      status: "ACTIVE",
      tenantId: input.tenantId,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    const linkItem = {
      PK: `APP#${input.applicationId}`,
      SK: `ACCOUNT#${input.externalAccountId}`,
      applicationId: input.applicationId,
      createdAt: input.now,
      entityType: "APP_TENANT_LINK",
      externalAccountId: input.externalAccountId,
      requestHash: input.requestHash,
      role: "OWNER",
      status: "ACTIVE",
      tenantId: input.tenantId,
      ...(input.externalAccountCode === undefined
        ? {}
        : { externalAccountCode: input.externalAccountCode }),
    };
    const inverseLinkItem = {
      PK: `TENANT#${input.tenantId}`,
      SK: `APP#${input.applicationId}#ACCOUNT#${input.externalAccountId}`,
      applicationId: input.applicationId,
      createdAt: input.now,
      entityType: "TENANT_APP_LINK",
      externalAccountId: input.externalAccountId,
      requestHash: input.requestHash,
      status: "ACTIVE",
      tenantId: input.tenantId,
    };
    const idempotencyItem = {
      PK: `IDEMPOTENCY#COMMAND#${input.applicationId}#${input.idempotencyKeyHash}`,
      SK: "LOCK",
      createdAt: input.now,
      entityType: "IDEMPOTENCY",
      expiresAt: input.idempotencyExpiresAt,
      requestHash: input.requestHash,
      resourceId: input.tenantId,
      status: "COMPLETED",
    };

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [tenantItem, linkItem, inverseLinkItem, idempotencyItem].map((Item) => ({
            Put: {
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              Item,
              TableName: this.#tableName,
            },
          })),
        }),
      );
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        throw new TenantStoreConflictError();
      }

      throw error;
    }
  }

  public async findLinkByTenant(
    applicationId: string,
    tenantId: string,
  ): Promise<AppTenantLinkRecord | undefined> {
    const response = await this.#client.send(
      new QueryCommand({
        ConsistentRead: true,
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}`,
          ":skPrefix": `APP#${applicationId}#ACCOUNT#`,
        },
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        Limit: 1,
        TableName: this.#tableName,
      }),
    );
    const item = response.Items?.[0];

    return item === undefined ? undefined : linkSchema.parse(item);
  }

  public async getIdempotency(
    applicationId: string,
    idempotencyKeyHash: string,
  ): Promise<IdempotencyRecord | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        Key: {
          PK: `IDEMPOTENCY#COMMAND#${applicationId}#${idempotencyKeyHash}`,
          SK: "LOCK",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : idempotencySchema.parse(response.Item);
  }

  public async getLink(
    applicationId: string,
    externalAccountId: string,
  ): Promise<AppTenantLinkRecord | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        Key: {
          PK: `APP#${applicationId}`,
          SK: `ACCOUNT#${externalAccountId}`,
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : linkSchema.parse(response.Item);
  }

  public async getTenant(tenantId: string): Promise<TenantRecord | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : tenantSchema.parse(response.Item);
  }
}
