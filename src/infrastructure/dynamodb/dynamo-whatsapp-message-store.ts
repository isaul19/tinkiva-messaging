import { createHash } from "node:crypto";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { buildConversationIndexKeys } from "./conversation-index.js";

import type {
  PersistWhatsappImageMessage,
  PersistWhatsappStatus,
  PersistWhatsappTextMessage,
  WhatsappMessageStore,
} from "../../application/ports/whatsapp-message-store.js";

const STATUS_RANK = {
  DELIVERED: 40,
  FAILED: 90,
  READ: 50,
  SENT: 30,
} as const;

export class DynamoWhatsappMessageStore implements WhatsappMessageStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async persistTextMessage(
    input: PersistWhatsappTextMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  public async persistImageMessage(
    input: PersistWhatsappImageMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  async #persistMessage(
    input: PersistWhatsappTextMessage | PersistWhatsappImageMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    const identityId = deterministicIdentityId(
      input.integrationId,
      input.canonicalType,
      input.canonicalValue,
    );
    const conversationId = deterministicConversationId(
      input.integrationId,
      input.canonicalType,
      input.canonicalValue,
    );
    const messageSortKey = `MESSAGE#${input.occurredAt}#${input.messageId}`;
    const conversationIndex = buildConversationIndexKeys({
      applicationId: input.applicationId,
      conversationId,
      integrationId: input.integrationId,
      lastMessageAt: input.occurredAt,
      tenantId: input.tenantId,
    });
    const aliases = [
      {
        type: input.canonicalType,
        value: input.canonicalValue,
      },
      ...(input.bsuid === undefined ||
      (input.canonicalType === "WHATSAPP_BSUID" && input.canonicalValue === input.bsuid)
        ? []
        : [{ type: "WHATSAPP_BSUID", value: input.bsuid }]),
      ...(input.phoneE164 === undefined
        ? []
        : [
            {
              type: "WHATSAPP_PHONE",
              value: input.phoneE164.replace(/^\+/, ""),
            },
          ]),
    ].filter(
      (alias, index, values) =>
        values.findIndex(
          (candidate) => candidate.type === alias.type && candidate.value === alias.value,
        ) === index,
    );

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `PROVIDER_EVENT#WHATSAPP#${input.integrationId}#${sha256(input.providerMessageId)}`,
                  SK: "PROCESSED",
                  entityType: "PROVIDER_EVENT_IDEMPOTENCY",
                  integrationId: input.integrationId,
                  occurredAt: input.occurredAt,
                  provider: "WHATSAPP",
                  providerEventId: input.providerMessageId,
                },
                TableName: this.#controlTable,
              },
            },
            {
              Update: {
                ExpressionAttributeNames: {
                  "#status": "status",
                },
                ExpressionAttributeValues: {
                  ":bsuid": input.bsuid ?? null,
                  ":canonicalType": input.canonicalType,
                  ":canonicalValue": input.canonicalValue,
                  ":displayName":
                    input.displayName ?? input.username ?? input.phoneE164 ?? input.canonicalValue,
                  ":entityType": "CONTACT_IDENTITY",
                  ":integrationId": input.integrationId,
                  ":phoneE164": input.phoneE164 ?? null,
                  ":status": "ACTIVE",
                  ":username": input.username ?? null,
                },
                Key: {
                  PK: `IDENTITY#${identityId}`,
                  SK: "META",
                },
                TableName: this.#controlTable,
                UpdateExpression:
                  "SET entityType = :entityType, integrationId = :integrationId, " +
                  "canonicalType = :canonicalType, canonicalValue = :canonicalValue, " +
                  "bsuid = :bsuid, phoneE164 = :phoneE164, displayName = :displayName, " +
                  "username = :username, #status = :status",
              },
            },
            ...aliases.map((alias) => ({
              Update: {
                ExpressionAttributeValues: {
                  ":entityType": "IDENTITY_ALIAS",
                  ":identityId": identityId,
                },
                Key: {
                  PK: `INTEGRATION#${input.integrationId}`,
                  SK: `IDENTITY_KEY#${alias.type}#${sha256(alias.value)}`,
                },
                TableName: this.#controlTable,
                UpdateExpression: "SET entityType = :entityType, identityId = :identityId",
              },
            })),
            {
              Update: {
                ExpressionAttributeNames: {
                  "#status": "status",
                },
                ExpressionAttributeValues: {
                  ":applicationId": input.applicationId,
                  ":conversationId": conversationId,
                  ":createdAt": input.occurredAt,
                  ":entityType": "CONVERSATION",
                  ":gsi1pk": conversationIndex.GSI1PK,
                  ":gsi1sk": conversationIndex.GSI1SK,
                  ":identityId": identityId,
                  ":integrationId": input.integrationId,
                  ":lastMessageAt": input.occurredAt,
                  ":status": "OPEN",
                  ":tenantId": input.tenantId,
                },
                Key: {
                  PK: `CONVERSATION#${conversationId}`,
                  SK: "META",
                },
                TableName: this.#controlTable,
                UpdateExpression:
                  "SET applicationId = :applicationId, entityType = :entityType, " +
                  "GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, conversationId = :conversationId, " +
                  "tenantId = :tenantId, integrationId = :integrationId, " +
                  "identityId = :identityId, createdAt = if_not_exists(createdAt, :createdAt), " +
                  "lastMessageAt = :lastMessageAt, #status = :status",
              },
            },
            {
              Update: {
                ExpressionAttributeValues: {
                  ":conversationId": conversationId,
                  ":entityType": "CONVERSATION_LOOKUP",
                },
                Key: {
                  PK: `INTEGRATION#${input.integrationId}`,
                  SK: `CONVERSATION_BY_IDENTITY#${identityId}`,
                },
                TableName: this.#controlTable,
                UpdateExpression: "SET entityType = :entityType, conversationId = :conversationId",
              },
            },
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `CONVERSATION#${conversationId}`,
                  SK: messageSortKey,
                  applicationId: input.applicationId,
                  conversationId,
                  direction: "INBOUND",
                  entityType: "MESSAGE",
                  integrationId: input.integrationId,
                  messageId: input.messageId,
                  occurredAt: input.occurredAt,
                  provider: "WHATSAPP",
                  providerMessageId: input.providerMessageId,
                  senderIdentityId: identityId,
                  status: "RECEIVED",
                  tenantId: input.tenantId,
                  ...("media" in input
                    ? {
                        ...(input.caption === undefined ? {} : { caption: input.caption }),
                        media: input.media,
                        type: "IMAGE",
                      }
                    : { text: input.text, type: "TEXT" }),
                },
                TableName: this.#dataTable,
              },
            },
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `MESSAGE#${input.messageId}`,
                  SK: "REF",
                  conversationId,
                  entityType: "MESSAGE_REF",
                  messageSortKey,
                  tenantId: input.tenantId,
                },
                TableName: this.#dataTable,
              },
            },
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `PROVIDER_MESSAGE#WHATSAPP#${input.integrationId}#${sha256(input.providerMessageId)}`,
                  SK: "REF",
                  conversationId,
                  entityType: "PROVIDER_MESSAGE_REF",
                  messageId: input.messageId,
                  messageSortKey,
                },
                TableName: this.#dataTable,
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
      ) {
        return "DUPLICATE";
      }

      throw error;
    }

    return "CREATED";
  }

  public async persistStatus(
    input: PersistWhatsappStatus,
  ): Promise<"IGNORED" | "UPDATED" | "DUPLICATE"> {
    const reference = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `PROVIDER_MESSAGE#WHATSAPP#${input.integrationId}#${sha256(input.providerMessageId)}`,
          SK: "REF",
        },
        TableName: this.#dataTable,
      }),
    );

    if (
      typeof reference.Item?.conversationId !== "string" ||
      typeof reference.Item.messageSortKey !== "string"
    ) {
      return "IGNORED";
    }

    const messageKey = {
      PK: `CONVERSATION#${reference.Item.conversationId}`,
      SK: reference.Item.messageSortKey,
    };
    const current = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: messageKey,
        TableName: this.#dataTable,
      }),
    );
    const statusRank = STATUS_RANK[input.status];

    if (typeof current.Item?.statusRank === "number" && current.Item.statusRank >= statusRank) {
      return "DUPLICATE";
    }

    const values: Record<string, string | number> = {
      ":occurredAt": input.occurredAt,
      ":status": input.status,
      ":statusRank": statusRank,
    };
    const failureUpdate =
      input.status === "FAILED" ? ", failureCode = :failureCode, failedAt = :occurredAt" : "";

    if (input.status === "FAILED") {
      values[":failureCode"] = input.errorCode ?? "WHATSAPP_SEND_FAILED";
    }

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `PROVIDER_EVENT#WHATSAPP#${input.integrationId}#${sha256(input.statusEventId)}`,
                  SK: "PROCESSED",
                  entityType: "PROVIDER_EVENT_IDEMPOTENCY",
                  integrationId: input.integrationId,
                  occurredAt: input.occurredAt,
                  provider: "WHATSAPP",
                  providerEventId: input.statusEventId,
                },
                TableName: this.#controlTable,
              },
            },
            {
              Update: {
                ConditionExpression:
                  "attribute_exists(PK) AND (attribute_not_exists(statusRank) OR statusRank < :statusRank)",
                ExpressionAttributeNames: {
                  "#status": "status",
                },
                ExpressionAttributeValues: values,
                Key: messageKey,
                TableName: this.#dataTable,
                UpdateExpression:
                  `SET #status = :status, statusRank = :statusRank, ` +
                  `statusUpdatedAt = :occurredAt${failureUpdate}`,
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
      ) {
        return "DUPLICATE";
      }

      throw error;
    }

    return "UPDATED";
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const deterministicIdentityId = (
  integrationId: string,
  canonicalType: string,
  canonicalValue: string,
): string =>
  `identity_${createHash("sha256")
    .update(`WHATSAPP:${integrationId}:${canonicalType}:${canonicalValue}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;

const deterministicConversationId = (
  integrationId: string,
  canonicalType: string,
  canonicalValue: string,
): string =>
  `conv_${createHash("sha256")
    .update(`WHATSAPP:${integrationId}:${canonicalType}:${canonicalValue}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;
