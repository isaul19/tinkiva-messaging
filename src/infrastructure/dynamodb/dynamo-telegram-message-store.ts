import { createHash } from "node:crypto";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { buildConversationIndexKeys } from "./conversation-index.js";

import type {
  PersistTelegramImageMessage,
  PersistTelegramTextMessage,
  TelegramMessageStore,
} from "../../application/ports/telegram-message-store.js";

export class DynamoTelegramMessageStore implements TelegramMessageStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async persistTextMessage(
    input: PersistTelegramTextMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  public async persistImageMessage(
    input: PersistTelegramImageMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  async #persistMessage(
    input: PersistTelegramTextMessage | PersistTelegramImageMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    const identityId = deterministicIdentityId(input.integrationId, input.chatId);
    const messageSortKey = `MESSAGE#${input.occurredAt}#${input.messageId}`;
    const conversationIndex = buildConversationIndexKeys({
      applicationId: input.applicationId,
      conversationId: input.conversationId,
      integrationId: input.integrationId,
      lastMessageAt: input.occurredAt,
      tenantId: input.tenantId,
    });
    const providerMessageHash = sha256(input.providerMessageId);

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `PROVIDER_EVENT#TELEGRAM#${input.integrationId}#${input.updateId}`,
                  SK: "PROCESSED",
                  entityType: "PROVIDER_EVENT_IDEMPOTENCY",
                  integrationId: input.integrationId,
                  occurredAt: input.occurredAt,
                  provider: "TELEGRAM",
                  providerEventId: input.updateId,
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
                  ":canonicalType": "TELEGRAM_CHAT_ID",
                  ":canonicalValue": input.chatId,
                  ":displayName": input.displayName ?? input.chatTitle ?? input.chatId,
                  ":entityType": "CONTACT_IDENTITY",
                  ":integrationId": input.integrationId,
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
                  "displayName = :displayName, username = :username, #status = :status",
              },
            },
            {
              Update: {
                ExpressionAttributeValues: {
                  ":entityType": "IDENTITY_ALIAS",
                  ":identityId": identityId,
                },
                Key: {
                  PK: `INTEGRATION#${input.integrationId}`,
                  SK: `IDENTITY_KEY#TELEGRAM_CHAT_ID#${sha256(input.chatId)}`,
                },
                TableName: this.#controlTable,
                UpdateExpression: "SET entityType = :entityType, identityId = :identityId",
              },
            },
            {
              Update: {
                ExpressionAttributeNames: {
                  "#status": "status",
                },
                ExpressionAttributeValues: {
                  ":applicationId": input.applicationId,
                  ":conversationId": input.conversationId,
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
                  PK: `CONVERSATION#${input.conversationId}`,
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
                  ":conversationId": input.conversationId,
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
                  PK: `CONVERSATION#${input.conversationId}`,
                  SK: messageSortKey,
                  applicationId: input.applicationId,
                  conversationId: input.conversationId,
                  direction: "INBOUND",
                  entityType: "MESSAGE",
                  integrationId: input.integrationId,
                  messageId: input.messageId,
                  occurredAt: input.occurredAt,
                  provider: "TELEGRAM",
                  providerMessageId: input.providerMessageId,
                  senderChatId: input.chatId,
                  senderUserId: input.senderUserId,
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
                  conversationId: input.conversationId,
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
                  PK: `PROVIDER_MESSAGE#TELEGRAM#${input.integrationId}#${providerMessageHash}`,
                  SK: "REF",
                  conversationId: input.conversationId,
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
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const deterministicIdentityId = (integrationId: string, chatId: string): string =>
  `identity_${createHash("sha256")
    .update(`TELEGRAM:${integrationId}:${chatId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;
