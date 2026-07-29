import { createHash } from "node:crypto";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type {
  AcquireWhatsappSendInput,
  AcquiredWhatsappSend,
  WhatsappSendStore,
} from "../../application/ports/whatsapp-send-store.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { readStoredMessageContent } from "./stored-message-content.js";

export class DynamoWhatsappSendStore implements WhatsappSendStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async acquire(input: AcquireWhatsappSendInput): Promise<AcquiredWhatsappSend> {
    const reference = await this.#get(this.#dataTable, {
      PK: `MESSAGE#${input.messageId}`,
      SK: "REF",
    });

    if (
      reference?.tenantId !== input.tenantId ||
      typeof reference.conversationId !== "string" ||
      typeof reference.messageSortKey !== "string"
    ) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "The queued message was not found.", 422);
    }

    const messageKey = {
      PK: `CONVERSATION#${reference.conversationId}`,
      SK: reference.messageSortKey,
    };
    const message = await this.#get(this.#dataTable, messageKey);
    const content = readStoredMessageContent(message);

    if (
      message?.status === "SENT" ||
      message?.status === "DELIVERED" ||
      message?.status === "READ" ||
      message?.status === "FAILED"
    ) {
      return { status: "TERMINAL" };
    }

    if (
      message?.applicationId !== input.applicationId ||
      message.integrationId !== input.integrationId ||
      message.messageId !== input.messageId ||
      typeof message.recipientId !== "string" ||
      content === undefined
    ) {
      throw new ApplicationError("MESSAGE_NOT_SENDABLE", "The queued message is invalid.", 422);
    }

    const integration = await this.#get(this.#controlTable, {
      PK: `INTEGRATION#${input.integrationId}`,
      SK: "META",
    });

    if (
      integration?.applicationId !== input.applicationId ||
      integration.tenantId !== input.tenantId ||
      integration.provider !== "WHATSAPP" ||
      typeof integration.providerConnectionId !== "string" ||
      typeof integration.phoneNumberId !== "string" ||
      typeof integration.graphApiVersion !== "string"
    ) {
      await this.#failBeforeClaim(messageKey, "INTEGRATION_NOT_FOUND");
      return { status: "TERMINAL" };
    }

    if (integration.status !== "ACTIVE") {
      await this.#failBeforeClaim(messageKey, "INTEGRATION_DISABLED");
      return { status: "TERMINAL" };
    }

    const providerConnection = await this.#get(this.#controlTable, {
      PK: `PROVIDER_CONNECTION#${integration.providerConnectionId}`,
      SK: "META",
    });

    if (
      providerConnection?.status !== "ACTIVE" ||
      typeof providerConnection.credentialRef !== "string"
    ) {
      await this.#failBeforeClaim(messageKey, "INTEGRATION_DISABLED");
      return { status: "TERMINAL" };
    }

    try {
      await this.#client.send(
        new UpdateCommand({
          ConditionExpression:
            "#status = :queued OR (#status = :processing AND processingAt < :leaseCutoff)",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":processing": "PROCESSING",
            ":processingAt": new Date().toISOString(),
            ":leaseCutoff": new Date(Date.now() - 5 * 60 * 1_000).toISOString(),
            ":queued": "QUEUED",
            ":statusRank": 20,
          },
          Key: messageKey,
          TableName: this.#dataTable,
          UpdateExpression:
            "SET #status = :processing, processingAt = :processingAt, statusRank = :statusRank",
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }

      const current = await this.#get(this.#dataTable, messageKey);

      if (
        current?.status === "SENT" ||
        current?.status === "DELIVERED" ||
        current?.status === "READ" ||
        current?.status === "FAILED"
      ) {
        return { status: "TERMINAL" };
      }

      throw new ApplicationError(
        "PROVIDER_UNAVAILABLE",
        "The WhatsApp message is already being processed.",
        503,
        true,
      );
    }

    return {
      conversationId: reference.conversationId,
      credentialRef: providerConnection.credentialRef,
      graphApiVersion: integration.graphApiVersion,
      messageSortKey: reference.messageSortKey,
      phoneNumberId: integration.phoneNumberId,
      ...(typeof message.providerMediaId === "string"
        ? { providerMediaId: message.providerMediaId }
        : {}),
      recipientId: message.recipientId,
      status: "CLAIMED",
      content,
    };
  }

  public async markSent(input: {
    conversationId: string;
    integrationId: string;
    messageId: string;
    messageSortKey: string;
    providerMessageId: string;
    sentAt: string;
  }): Promise<void> {
    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              ConditionExpression: "#status = :processing",
              ExpressionAttributeNames: {
                "#status": "status",
              },
              ExpressionAttributeValues: {
                ":processing": "PROCESSING",
                ":providerMessageId": input.providerMessageId,
                ":sent": "SENT",
                ":sentAt": input.sentAt,
                ":statusRank": 30,
              },
              Key: {
                PK: `CONVERSATION#${input.conversationId}`,
                SK: input.messageSortKey,
              },
              TableName: this.#dataTable,
              UpdateExpression:
                "SET #status = :sent, statusRank = :statusRank, " +
                "providerMessageId = :providerMessageId, sentAt = :sentAt",
            },
          },
          {
            Put: {
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              Item: {
                PK: `PROVIDER_MESSAGE#WHATSAPP#${input.integrationId}#${sha256(input.providerMessageId)}`,
                SK: "REF",
                conversationId: input.conversationId,
                entityType: "PROVIDER_MESSAGE_REF",
                messageId: input.messageId,
                messageSortKey: input.messageSortKey,
              },
              TableName: this.#dataTable,
            },
          },
        ],
      }),
    );
  }

  public async markFailed(input: {
    conversationId: string;
    failedAt: string;
    failureCode: string;
    messageSortKey: string;
  }): Promise<void> {
    await this.#setStatus(
      input,
      "FAILED",
      {
        ":failedAt": input.failedAt,
        ":failureCode": input.failureCode,
        ":statusRank": 90,
      },
      "failedAt = :failedAt, failureCode = :failureCode, statusRank = :statusRank",
    );
  }

  public async release(input: {
    conversationId: string;
    messageSortKey: string;
    releasedAt: string;
  }): Promise<void> {
    await this.#setStatus(
      input,
      "QUEUED",
      {
        ":releasedAt": input.releasedAt,
        ":statusRank": 10,
      },
      "lastRetryAt = :releasedAt, statusRank = :statusRank",
    );
  }

  public async saveProviderMediaId(input: {
    conversationId: string;
    messageSortKey: string;
    providerMediaId: string;
  }): Promise<void> {
    await this.#client.send(
      new UpdateCommand({
        ConditionExpression: "#status = :processing",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":processing": "PROCESSING",
          ":providerMediaId": input.providerMediaId,
        },
        Key: {
          PK: `CONVERSATION#${input.conversationId}`,
          SK: input.messageSortKey,
        },
        TableName: this.#dataTable,
        UpdateExpression: "SET providerMediaId = if_not_exists(providerMediaId, :providerMediaId)",
      }),
    );
  }

  async #failBeforeClaim(Key: { PK: string; SK: string }, failureCode: string): Promise<void> {
    await this.#client.send(
      new UpdateCommand({
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":failedAt": new Date().toISOString(),
          ":failureCode": failureCode,
          ":statusRank": 90,
        },
        Key,
        TableName: this.#dataTable,
        UpdateExpression:
          "SET #status = :failed, failedAt = :failedAt, " +
          "failureCode = :failureCode, statusRank = :statusRank",
      }),
    );
  }

  async #get(
    TableName: string,
    Key: { PK: string; SK: string },
  ): Promise<Record<string, unknown> | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key,
        TableName,
      }),
    );

    return response.Item;
  }

  async #setStatus(
    input: { conversationId: string; messageSortKey: string },
    status: "FAILED" | "QUEUED",
    additionalValues: Record<string, number | string>,
    additionalUpdate: string,
  ): Promise<void> {
    await this.#client.send(
      new UpdateCommand({
        ConditionExpression: "#status = :processing",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":processing": "PROCESSING",
          ":status": status,
          ...additionalValues,
        },
        Key: {
          PK: `CONVERSATION#${input.conversationId}`,
          SK: input.messageSortKey,
        },
        TableName: this.#dataTable,
        UpdateExpression: `SET #status = :status, ${additionalUpdate}`,
      }),
    );
  }
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
