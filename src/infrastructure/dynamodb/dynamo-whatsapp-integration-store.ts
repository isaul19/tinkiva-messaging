import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import type {
  CreateWhatsappIntegrationRecords,
  DeletePendingWhatsappIntegrationRecords,
  WhatsappIntegrationStore,
} from "../../application/ports/whatsapp-integration-store.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export class DynamoWhatsappIntegrationStore implements WhatsappIntegrationStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async createPending(input: CreateWhatsappIntegrationRecords): Promise<void> {
    const records = [
      {
        PK: `PROVIDER_CONNECTION#${input.providerConnectionId}`,
        SK: "META",
        applicationId: input.applicationId,
        ...(input.businessPortfolioId === undefined
          ? {}
          : { businessPortfolioId: input.businessPortfolioId }),
        createdAt: input.createdAt,
        credentialRef: input.credentialRef,
        credentialStorage: "DYNAMODB_KMS",
        entityType: "PROVIDER_CONNECTION",
        graphApiVersion: input.graphApiVersion,
        metaAppId: input.metaAppId,
        provider: "WHATSAPP",
        providerConnectionId: input.providerConnectionId,
        scope: "TENANT",
        status: "PENDING",
        tenantId: input.tenantId,
        wabaId: input.wabaId,
        webhookKey: input.webhookKey,
      },
      {
        PK: `INTEGRATION#${input.integrationId}`,
        SK: "META",
        applicationId: input.applicationId,
        createdAt: input.createdAt,
        displayName: input.displayName,
        ...(input.displayPhoneNumber === undefined
          ? {}
          : { displayPhoneNumber: input.displayPhoneNumber }),
        entityType: "CHANNEL_INTEGRATION",
        graphApiVersion: input.graphApiVersion,
        integrationId: input.integrationId,
        phoneNumberId: input.phoneNumberId,
        provider: "WHATSAPP",
        providerAccountId: input.phoneNumberId,
        providerConnectionId: input.providerConnectionId,
        status: "PENDING",
        tenantId: input.tenantId,
        ...(input.verifiedName === undefined ? {} : { verifiedName: input.verifiedName }),
        wabaId: input.wabaId,
        webhookUrl: input.webhookUrl,
      },
      {
        PK: `TENANT#${input.tenantId}`,
        SK: `INTEGRATION#WHATSAPP#${input.integrationId}`,
        displayName: input.displayName,
        ...(input.displayPhoneNumber === undefined
          ? {}
          : { displayPhoneNumber: input.displayPhoneNumber }),
        entityType: "TENANT_INTEGRATION_REF",
        integrationId: input.integrationId,
        phoneNumberId: input.phoneNumberId,
        provider: "WHATSAPP",
        status: "PENDING",
      },
      {
        PK: `WEBHOOK#WHATSAPP#${input.webhookKey}`,
        SK: "REF",
        applicationId: input.applicationId,
        credentialRef: input.credentialRef,
        entityType: "WHATSAPP_WEBHOOK_REF",
        providerConnectionId: input.providerConnectionId,
        status: "PENDING",
        tenantId: input.tenantId,
      },
      {
        PK: `WHATSAPP_WABA#${input.wabaId}`,
        SK: "REF",
        applicationId: input.applicationId,
        entityType: "WHATSAPP_WABA_REF",
        metaAppId: input.metaAppId,
        providerConnectionId: input.providerConnectionId,
        status: "PENDING",
        tenantId: input.tenantId,
        webhookKey: input.webhookKey,
      },
      {
        PK: `WHATSAPP_PHONE_NUMBER#${input.phoneNumberId}`,
        SK: "REF",
        applicationId: input.applicationId,
        entityType: "WHATSAPP_PHONE_NUMBER_REF",
        integrationId: input.integrationId,
        providerConnectionId: input.providerConnectionId,
        status: "PENDING",
        tenantId: input.tenantId,
      },
    ];

    try {
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
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed") ===
          true
      ) {
        throw new ApplicationError(
          "PROVIDER_CONFIGURATION_INVALID",
          "The WhatsApp WABA or phone number is already registered.",
          409,
        );
      }

      throw error;
    }
  }

  public async deletePending(input: DeletePendingWhatsappIntegrationRecords): Promise<void> {
    const records = [
      {
        expectedAttribute: "providerConnectionId",
        expectedValue: input.providerConnectionId,
        Key: {
          PK: `PROVIDER_CONNECTION#${input.providerConnectionId}`,
          SK: "META",
        },
      },
      {
        expectedAttribute: "providerConnectionId",
        expectedValue: input.providerConnectionId,
        Key: {
          PK: `INTEGRATION#${input.integrationId}`,
          SK: "META",
        },
      },
      {
        expectedAttribute: "integrationId",
        expectedValue: input.integrationId,
        Key: {
          PK: `TENANT#${input.tenantId}`,
          SK: `INTEGRATION#WHATSAPP#${input.integrationId}`,
        },
      },
      {
        expectedAttribute: "providerConnectionId",
        expectedValue: input.providerConnectionId,
        Key: {
          PK: `WEBHOOK#WHATSAPP#${input.webhookKey}`,
          SK: "REF",
        },
      },
      {
        expectedAttribute: "providerConnectionId",
        expectedValue: input.providerConnectionId,
        Key: {
          PK: `WHATSAPP_WABA#${input.wabaId}`,
          SK: "REF",
        },
      },
      {
        expectedAttribute: "providerConnectionId",
        expectedValue: input.providerConnectionId,
        Key: {
          PK: `WHATSAPP_PHONE_NUMBER#${input.phoneNumberId}`,
          SK: "REF",
        },
      },
    ];

    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: records.map(({ expectedAttribute, expectedValue, Key }) => ({
          Delete: {
            ConditionExpression: `${expectedAttribute} = :expectedValue`,
            ExpressionAttributeValues: {
              ":expectedValue": expectedValue,
            },
            Key,
            TableName: this.#tableName,
          },
        })),
      }),
    );
  }

  public async setStatus(
    integrationId: string,
    phoneNumberId: string,
    providerConnectionId: string,
    tenantId: string,
    wabaId: string,
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
        SK: `INTEGRATION#WHATSAPP#${integrationId}`,
      },
      {
        PK: `WEBHOOK#WHATSAPP#${webhookKey}`,
        SK: "REF",
      },
      {
        PK: `WHATSAPP_WABA#${wabaId}`,
        SK: "REF",
      },
      {
        PK: `WHATSAPP_PHONE_NUMBER#${phoneNumberId}`,
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
