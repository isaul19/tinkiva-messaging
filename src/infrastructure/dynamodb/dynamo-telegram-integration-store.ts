import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import type {
  CreateTelegramIntegrationRecords,
  TelegramIntegrationStore,
} from "../../application/ports/telegram-integration-store.js";

export class DynamoTelegramIntegrationStore implements TelegramIntegrationStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async createPending(input: CreateTelegramIntegrationRecords): Promise<void> {
    const records = [
      {
        PK: `PROVIDER_CONNECTION#${input.providerConnectionId}`,
        SK: "META",
        applicationId: input.applicationId,
        createdAt: input.createdAt,
        entityType: "PROVIDER_CONNECTION",
        provider: "TELEGRAM",
        providerConnectionId: input.providerConnectionId,
        scope: "TENANT",
        secretArn: input.secretArn,
        status: "PENDING",
        tenantId: input.tenantId,
        webhookKey: input.webhookKey,
      },
      {
        PK: `INTEGRATION#${input.integrationId}`,
        SK: "META",
        applicationId: input.applicationId,
        botId: input.botId,
        botUsername: input.botUsername,
        createdAt: input.createdAt,
        displayName: input.displayName,
        entityType: "CHANNEL_INTEGRATION",
        integrationId: input.integrationId,
        provider: "TELEGRAM",
        providerAccountId: input.botId,
        providerConnectionId: input.providerConnectionId,
        status: "PENDING",
        tenantId: input.tenantId,
        webhookUrl: input.webhookUrl,
      },
      {
        PK: `TENANT#${input.tenantId}`,
        SK: `INTEGRATION#TELEGRAM#${input.integrationId}`,
        botId: input.botId,
        botUsername: input.botUsername,
        displayName: input.displayName,
        entityType: "TENANT_INTEGRATION_REF",
        integrationId: input.integrationId,
        provider: "TELEGRAM",
        status: "PENDING",
      },
      {
        PK: `WEBHOOK#TELEGRAM#${input.webhookKey}`,
        SK: "REF",
        applicationId: input.applicationId,
        entityType: "TELEGRAM_WEBHOOK_REF",
        integrationId: input.integrationId,
        secretArn: input.secretArn,
        status: "PENDING",
        tenantId: input.tenantId,
      },
      {
        PK: `TELEGRAM_BOT#${input.botId}`,
        SK: "REF",
        entityType: "TELEGRAM_BOT_REF",
        integrationId: input.integrationId,
        tenantId: input.tenantId,
      },
    ];

    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: records.map((Item) => ({
          Put: {
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            Item,
            TableName: this.#tableName,
          },
        })),
      }),
    );
  }

  public async setStatus(
    integrationId: string,
    providerConnectionId: string,
    tenantId: string,
    webhookKey: string,
    status: "ACTIVE" | "ERROR",
    updatedAt: string,
  ): Promise<void> {
    const keys = [
      {
        PK: `PROVIDER_CONNECTION#${providerConnectionId}`,
        SK: "META",
      },
      {
        PK: `INTEGRATION#${integrationId}`,
        SK: "META",
      },
      {
        PK: `TENANT#${tenantId}`,
        SK: `INTEGRATION#TELEGRAM#${integrationId}`,
      },
      {
        PK: `WEBHOOK#TELEGRAM#${webhookKey}`,
        SK: "REF",
      },
    ];

    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: keys.map((Key) => ({
          Update: {
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":status": status,
              ":updatedAt": updatedAt,
            },
            Key,
            TableName: this.#tableName,
            UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
          },
        })),
      }),
    );
  }
}
