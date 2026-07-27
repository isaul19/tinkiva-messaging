import { createHash } from "node:crypto";

import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { buildConversationIndexKeys } from "./conversation-index.js";

import type {
  ReserveWhatsappMessageInput,
  ReservedWhatsappMessage,
  ResolveWhatsappDestinationInput,
  WhatsappDestination,
  WhatsappOutgoingMessageStore,
} from "../../application/ports/whatsapp-outgoing-message-store.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export class DynamoWhatsappOutgoingMessageStore implements WhatsappOutgoingMessageStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async resolveWhatsappDestination(
    input: ResolveWhatsappDestinationInput,
  ): Promise<WhatsappDestination> {
    const integration = await this.#getControlRecord({
      PK: `INTEGRATION#${input.integrationId}`,
      SK: "META",
    });

    if (
      integration?.applicationId !== input.applicationId ||
      integration.tenantId !== input.tenantId ||
      integration.provider !== "WHATSAPP"
    ) {
      throw new ApplicationError(
        "INTEGRATION_NOT_FOUND",
        "The WhatsApp integration was not found.",
        404,
      );
    }

    if (integration.status !== "ACTIVE") {
      throw new ApplicationError(
        "INTEGRATION_DISABLED",
        "The WhatsApp integration is not active.",
        409,
      );
    }

    if (input.recipient !== undefined) {
      const normalized = normalizeRecipient(input.recipient.type, input.recipient.value);
      const conversationId = deterministicConversationId(
        input.integrationId,
        normalized.type,
        normalized.value,
      );

      return {
        conversationId,
        createDestinationRecords: true,
        recipientId: normalized.value,
        recipientType: normalized.type,
      };
    }

    if (input.conversationId === undefined) {
      throw conversationNotFoundError();
    }

    const conversation = await this.#getControlRecord({
      PK: `CONVERSATION#${input.conversationId}`,
      SK: "META",
    });

    if (
      conversation?.tenantId !== input.tenantId ||
      conversation.integrationId !== input.integrationId ||
      typeof conversation.identityId !== "string"
    ) {
      throw conversationNotFoundError();
    }

    const identity = await this.#getControlRecord({
      PK: `IDENTITY#${conversation.identityId}`,
      SK: "META",
    });

    if (typeof identity?.phoneE164 === "string") {
      const phone = normalizeRecipient("WHATSAPP_PHONE", identity.phoneE164);

      return {
        conversationId: input.conversationId,
        createDestinationRecords: false,
        recipientId: phone.value,
        recipientType: phone.type,
      };
    }

    if (
      (identity?.canonicalType !== "WHATSAPP_BSUID" &&
        identity?.canonicalType !== "WHATSAPP_PHONE") ||
      typeof identity.canonicalValue !== "string"
    ) {
      throw new ApplicationError(
        "RECIPIENT_INVALID",
        "The conversation has no WhatsApp destination.",
        409,
      );
    }

    return {
      conversationId: input.conversationId,
      createDestinationRecords: false,
      recipientId: identity.canonicalValue,
      recipientType: identity.canonicalType,
    };
  }

  public async reserveWhatsappMessage(
    input: ReserveWhatsappMessageInput,
  ): Promise<ReservedWhatsappMessage> {
    const idempotencyKey = commandIdempotencyKey(input.applicationId, input.idempotencyKey);
    const messageSortKey = `MESSAGE#${input.occurredAt}#${input.messageId}`;
    const identityId = deterministicIdentityId(
      input.integrationId,
      input.recipientType,
      input.recipientId,
    );
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
                  clientReferenceId: input.clientReferenceId,
                  conversationId: input.conversationId,
                  direction: "OUTBOUND",
                  entityType: "MESSAGE",
                  integrationId: input.integrationId,
                  messageId: input.messageId,
                  occurredAt: input.occurredAt,
                  provider: "WHATSAPP",
                  recipientId: input.recipientId,
                  recipientType: input.recipientType,
                  status: "QUEUED",
                  statusRank: 10,
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

  #destinationWrites(input: ReserveWhatsappMessageInput, identityId: string) {
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
            ":canonicalType": input.recipientType,
            ":canonicalValue": input.recipientId,
            ":displayName": input.recipientId,
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
            SK: `IDENTITY_KEY#${input.recipientType}#${sha256(input.recipientId)}`,
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
          Key: {
            PK: `CONVERSATION#${input.conversationId}`,
            SK: "META",
          },
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

const normalizeRecipient = (
  type: "TELEGRAM_CHAT_ID" | "WHATSAPP_BSUID" | "WHATSAPP_PHONE",
  value: string,
): {
  type: "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
  value: string;
} => {
  if (type === "WHATSAPP_PHONE") {
    const normalized = value.replace(/^\+/, "");

    if (!/^\d{7,15}$/.test(normalized)) {
      throw invalidRecipientError();
    }

    return { type, value: normalized };
  }

  if (type === "WHATSAPP_BSUID" && value.length <= 255) {
    return { type, value };
  }

  throw invalidRecipientError();
};

const invalidRecipientError = (): ApplicationError =>
  new ApplicationError(
    "RECIPIENT_INVALID",
    "A WHATSAPP_PHONE or WHATSAPP_BSUID recipient is required.",
    400,
  );

const conversationNotFoundError = (): ApplicationError =>
  new ApplicationError("CONVERSATION_NOT_FOUND", "The WhatsApp conversation was not found.", 404);

const commandIdempotencyKey = (applicationId: string, idempotencyKey: string) => ({
  PK: `IDEMPOTENCY#COMMAND#${applicationId}#${sha256(idempotencyKey)}`,
  SK: "LOCK",
});

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const deterministicIdentityId = (
  integrationId: string,
  recipientType: string,
  recipientId: string,
): string =>
  `identity_${createHash("sha256")
    .update(`WHATSAPP:${integrationId}:${recipientType}:${recipientId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;

const deterministicConversationId = (
  integrationId: string,
  recipientType: string,
  recipientId: string,
): string =>
  `conv_${createHash("sha256")
    .update(`WHATSAPP:${integrationId}:${recipientType}:${recipientId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;
