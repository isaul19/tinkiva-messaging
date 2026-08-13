import { createHash } from "node:crypto";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { buildConversationIndexKeys } from "./conversation-index.js";

import type {
  PersistTelegramAudioMessage,
  PersistTelegramImageMessage,
  PersistTelegramLocationMessage,
  PersistTelegramTextMessage,
  TelegramMessageStore,
} from "../../application/ports/telegram-message-store.js";
import type { MediaEnrichmentJobPublisher } from "../../application/ports/media-enrichment-job-publisher.js";
import {
  mediaEnrichmentJobSchema,
  type MediaEnrichmentJob,
} from "../../contracts/queues/media-enrichment.contract.js";

export class DynamoTelegramMessageStore implements TelegramMessageStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;
  readonly #enrichment: MediaEnrichmentJobPublisher | undefined;

  public constructor(
    client: DynamoDBDocumentClient,
    controlTable: string,
    dataTable: string,
    enrichment?: MediaEnrichmentJobPublisher,
  ) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
    this.#enrichment = enrichment;
  }

  public async persistTextMessage(
    input: PersistTelegramTextMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  public async persistAudioMessage(
    input: PersistTelegramAudioMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  public async persistImageMessage(
    input: PersistTelegramImageMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  public async persistLocationMessage(
    input: PersistTelegramLocationMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    return this.#persistMessage(input);
  }

  async #persistMessage(
    input:
      | PersistTelegramAudioMessage
      | PersistTelegramTextMessage
      | PersistTelegramImageMessage
      | PersistTelegramLocationMessage,
  ): Promise<"CREATED" | "DUPLICATE"> {
    const enrichment =
      "media" in input && input.alternativeTextRequested === true
        ? this.#requiredEnrichmentPublisher()
        : undefined;
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
    const requestedJob =
      enrichment === undefined || !("media" in input)
        ? undefined
        : mediaEnrichmentJobSchema.parse({
            applicationId: input.applicationId,
            ...(input.caption === undefined ? {} : { caption: input.caption }),
            conversationId: input.conversationId,
            integrationId: input.integrationId,
            media: input.media,
            messageId: input.messageId,
            messageSortKey,
            tenantId: input.tenantId,
            type: "voice" in input ? "AUDIO" : "IMAGE",
          });
    let result: "CREATED" | "DUPLICATE" = "CREATED";

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                ConditionExpression:
                  "applicationId = :applicationId AND tenantId = :tenantId " +
                  "AND integrationId = :integrationId AND #status = :active",
                ExpressionAttributeNames: { "#status": "status" },
                ExpressionAttributeValues: {
                  ":active": "ACTIVE",
                  ":applicationId": input.applicationId,
                  ":integrationId": input.integrationId,
                  ":tenantId": input.tenantId,
                },
                Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
                TableName: this.#controlTable,
              },
            },
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `PROVIDER_EVENT#TELEGRAM#${input.integrationId}#${input.updateId}`,
                  SK: "PROCESSED",
                  entityType: "PROVIDER_EVENT_IDEMPOTENCY",
                  expiresAt: Math.floor(Date.now() / 1_000) + 30 * 24 * 60 * 60,
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
                    ? "voice" in input
                      ? {
                          ...(input.caption === undefined ? {} : { caption: input.caption }),
                          ...(input.durationSeconds === undefined
                            ? {}
                            : { durationSeconds: input.durationSeconds }),
                          media: input.media,
                          ...(input.alternativeTextRequested === true
                            ? { metadata: { alternativeTextStatus: "PENDING" } }
                            : {}),
                          type: "AUDIO",
                          voice: input.voice,
                        }
                      : {
                          ...(input.caption === undefined ? {} : { caption: input.caption }),
                          media: input.media,
                          ...(input.alternativeTextRequested === true
                            ? { metadata: { alternativeTextStatus: "PENDING" } }
                            : {}),
                          type: "IMAGE",
                        }
                    : "latitude" in input
                      ? {
                          latitude: input.latitude,
                          longitude: input.longitude,
                          type: "LOCATION",
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
        result = "DUPLICATE";
      } else {
        throw error;
      }
    }

    if (enrichment !== undefined && requestedJob !== undefined) {
      const job =
        result === "CREATED"
          ? requestedJob
          : await this.#pendingEnrichmentJob(input.conversationId, messageSortKey);
      if (job !== undefined) await enrichment.publish(job);
    }

    return result;
  }

  #requiredEnrichmentPublisher(): MediaEnrichmentJobPublisher {
    if (this.#enrichment === undefined) {
      throw new Error("Media enrichment was requested without a configured job publisher.");
    }
    return this.#enrichment;
  }

  async #pendingEnrichmentJob(
    conversationId: string,
    messageSortKey: string,
  ): Promise<MediaEnrichmentJob | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { PK: `CONVERSATION#${conversationId}`, SK: messageSortKey },
        TableName: this.#dataTable,
      }),
    );
    const pending = pendingEnrichmentMessageSchema.safeParse(response.Item);
    if (!pending.success) return undefined;
    const message = pending.data;

    return mediaEnrichmentJobSchema.parse({
      applicationId: message.applicationId,
      ...(typeof message.caption === "string" ? { caption: message.caption } : {}),
      conversationId: message.conversationId,
      integrationId: message.integrationId,
      media: message.media,
      messageId: message.messageId,
      messageSortKey,
      tenantId: message.tenantId,
      type: message.type,
    });
  }
}

const pendingEnrichmentMessageSchema = z.looseObject({
  direction: z.literal("INBOUND"),
  entityType: z.literal("MESSAGE"),
  metadata: z.looseObject({ alternativeTextStatus: z.literal("PENDING") }),
});

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const deterministicIdentityId = (integrationId: string, chatId: string): string =>
  `identity_${createHash("sha256")
    .update(`TELEGRAM:${integrationId}:${chatId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;
