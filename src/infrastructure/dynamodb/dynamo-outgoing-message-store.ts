import { createHash } from "node:crypto";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { buildConversationIndexKeys } from "./conversation-index.js";

import type {
  OutgoingMessageStore,
  ReserveTelegramMessageInput,
  ReservedTelegramMessage,
  ResolveTelegramDestinationInput,
  TelegramDestination,
} from "../../application/ports/outgoing-message-store.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export class DynamoOutgoingMessageStore implements OutgoingMessageStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async resolveTelegramDestination(
    input: ResolveTelegramDestinationInput,
  ): Promise<TelegramDestination> {
    const integration = await this.#getControlRecord({
      PK: `INTEGRATION#${input.integrationId}`,
      SK: "META",
    });

    if (
      integration?.applicationId !== input.applicationId ||
      integration.tenantId !== input.tenantId ||
      integration.provider !== "TELEGRAM"
    ) {
      throw new ApplicationError(
        "INTEGRATION_NOT_FOUND",
        "The Telegram integration was not found.",
        404,
      );
    }

    if (integration.status !== "ACTIVE") {
      throw new ApplicationError(
        "INTEGRATION_DISABLED",
        "The Telegram integration is not active.",
        409,
      );
    }

    if (input.recipient !== undefined) {
      if (input.recipient.type !== "TELEGRAM_CHAT_ID" || !/^-?\d+$/.test(input.recipient.value)) {
        throw new ApplicationError(
          "RECIPIENT_INVALID",
          "A numeric TELEGRAM_CHAT_ID recipient is required.",
          400,
        );
      }

      return {
        chatId: input.recipient.value,
        conversationId: deterministicConversationId(input.integrationId, input.recipient.value),
        createDestinationRecords: true,
      };
    }

    const conversationId = input.conversationId;

    if (conversationId === undefined) {
      throw new ApplicationError(
        "CONVERSATION_NOT_FOUND",
        "The Telegram conversation was not found.",
        404,
      );
    }

    const conversation = await this.#getControlRecord({
      PK: `CONVERSATION#${conversationId}`,
      SK: "META",
    });

    if (
      conversation?.tenantId !== input.tenantId ||
      conversation.integrationId !== input.integrationId ||
      typeof conversation.identityId !== "string"
    ) {
      throw new ApplicationError(
        "CONVERSATION_NOT_FOUND",
        "The Telegram conversation was not found.",
        404,
      );
    }

    const identity = await this.#getControlRecord({
      PK: `IDENTITY#${conversation.identityId}`,
      SK: "META",
    });

    if (
      identity?.canonicalType !== "TELEGRAM_CHAT_ID" ||
      typeof identity.canonicalValue !== "string"
    ) {
      throw new ApplicationError(
        "RECIPIENT_INVALID",
        "The conversation has no Telegram chat destination.",
        409,
      );
    }

    return {
      chatId: identity.canonicalValue,
      conversationId,
      createDestinationRecords: false,
    };
  }

  public async reserveTelegramMessage(
    input: ReserveTelegramMessageInput,
  ): Promise<ReservedTelegramMessage> {
    const idempotencyKey = commandIdempotencyKey(input.applicationId, input.idempotencyKey);
    const messageSortKey = `MESSAGE#${input.occurredAt}#${input.messageId}`;
    const identityId = deterministicIdentityId(input.integrationId, input.chatId);
    const conversationIndex = buildConversationIndexKeys({
      applicationId: input.applicationId,
      conversationId: input.conversationId,
      integrationId: input.integrationId,
      lastMessageAt: input.occurredAt,
      tenantId: input.tenantId,
    });
    const destinationWrites = input.createDestinationRecords
      ? this.#destinationWrites(input, identityId)
      : [
          {
            Update: {
              ConditionExpression:
                "attribute_exists(PK) AND tenantId = :tenantId AND integrationId = :integrationId",
              ExpressionAttributeValues: {
                ":applicationId": input.applicationId,
                ":gsi1pk": conversationIndex.GSI1PK,
                ":gsi1sk": conversationIndex.GSI1SK,
                ":integrationId": input.integrationId,
                ":lastMessageAt": input.occurredAt,
                ":tenantId": input.tenantId,
              },
              Key: {
                PK: `CONVERSATION#${input.conversationId}`,
                SK: "META",
              },
              TableName: this.#controlTable,
              UpdateExpression:
                "SET applicationId = :applicationId, GSI1PK = :gsi1pk, " +
                "GSI1SK = :gsi1sk, lastMessageAt = :lastMessageAt",
            },
          },
        ];

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  ...idempotencyKey,
                  createdAt: input.occurredAt,
                  entityType: "IDEMPOTENCY",
                  expiresAt: Math.floor(Date.now() / 1_000) + 7 * 24 * 60 * 60,
                  messageId: input.messageId,
                  requestHash: input.requestHash,
                  status: "CREATED",
                },
                TableName: this.#controlTable,
              },
            },
            ...destinationWrites,
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  PK: `CONVERSATION#${input.conversationId}`,
                  SK: messageSortKey,
                  applicationId: input.applicationId,
                  chatId: input.chatId,
                  clientReferenceId: input.clientReferenceId,
                  conversationId: input.conversationId,
                  direction: "OUTBOUND",
                  entityType: "MESSAGE",
                  integrationId: input.integrationId,
                  messageId: input.messageId,
                  occurredAt: input.occurredAt,
                  provider: "TELEGRAM",
                  status: "QUEUED",
                  tenantId: input.tenantId,
                  text: input.text,
                  type: "TEXT",
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
          ],
        }),
      );

      return { messageId: input.messageId, status: "CREATED" };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) {
        throw error;
      }

      const existing = await this.#getControlRecord(idempotencyKey);

      if (
        existing === undefined ||
        typeof existing.messageId !== "string" ||
        (existing.status !== "CREATED" && existing.status !== "ENQUEUED")
      ) {
        throw error;
      }

      if (existing.requestHash !== input.requestHash) {
        throw new ApplicationError(
          "IDEMPOTENCY_KEY_REUSED",
          "The Idempotency-Key was already used with a different request.",
          409,
        );
      }

      return {
        messageId: existing.messageId,
        status: existing.status,
      };
    }
  }

  public async markEnqueued(input: {
    applicationId: string;
    enqueuedAt: string;
    idempotencyKey: string;
    messageId: string;
    requestHash: string;
  }): Promise<void> {
    await this.#client.send(
      new UpdateCommand({
        ConditionExpression: "messageId = :messageId AND requestHash = :requestHash",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":enqueuedAt": input.enqueuedAt,
          ":messageId": input.messageId,
          ":requestHash": input.requestHash,
          ":status": "ENQUEUED",
        },
        Key: commandIdempotencyKey(input.applicationId, input.idempotencyKey),
        TableName: this.#controlTable,
        UpdateExpression: "SET #status = :status, enqueuedAt = :enqueuedAt",
      }),
    );
  }

  async #getControlRecord(Key: {
    PK: string;
    SK: string;
  }): Promise<Record<string, unknown> | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key,
        TableName: this.#controlTable,
      }),
    );

    return response.Item;
  }

  #destinationWrites(input: ReserveTelegramMessageInput, identityId: string) {
    const conversationIndex = buildConversationIndexKeys({
      applicationId: input.applicationId,
      conversationId: input.conversationId,
      integrationId: input.integrationId,
      lastMessageAt: input.occurredAt,
      tenantId: input.tenantId,
    });

    return [
      {
        Update: {
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":canonicalType": "TELEGRAM_CHAT_ID",
            ":canonicalValue": input.chatId,
            ":displayName": input.chatId,
            ":entityType": "CONTACT_IDENTITY",
            ":integrationId": input.integrationId,
            ":status": "ACTIVE",
          },
          Key: { PK: `IDENTITY#${identityId}`, SK: "META" },
          TableName: this.#controlTable,
          UpdateExpression:
            "SET entityType = :entityType, integrationId = :integrationId, " +
            "canonicalType = :canonicalType, canonicalValue = :canonicalValue, " +
            "displayName = :displayName, #status = :status",
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
          ExpressionAttributeNames: { "#status": "status" },
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
          Key: { PK: `CONVERSATION#${input.conversationId}`, SK: "META" },
          TableName: this.#controlTable,
          UpdateExpression:
            "SET applicationId = :applicationId, entityType = :entityType, " +
            "GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, conversationId = :conversationId, " +
            "tenantId = :tenantId, integrationId = :integrationId, identityId = :identityId, " +
            "createdAt = if_not_exists(createdAt, :createdAt), " +
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
    ];
  }
}

const commandIdempotencyKey = (applicationId: string, idempotencyKey: string) => ({
  PK: `IDEMPOTENCY#COMMAND#${applicationId}#${sha256(idempotencyKey)}`,
  SK: "LOCK",
});

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const deterministicIdentityId = (integrationId: string, chatId: string): string =>
  `identity_${createHash("sha256")
    .update(`TELEGRAM:${integrationId}:${chatId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;

const deterministicConversationId = (integrationId: string, chatId: string): string =>
  `conv_${createHash("sha256")
    .update(`TELEGRAM:${integrationId}:${chatId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;
