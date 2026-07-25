import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import type {
  AcquiredTelegramSend,
  AcquireTelegramSendInput,
  TelegramSendStore,
} from "../../application/ports/telegram-send-store.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export class DynamoTelegramSendStore implements TelegramSendStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async acquire(input: AcquireTelegramSendInput): Promise<AcquiredTelegramSend> {
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

    if (message?.status === "SENT" || message?.status === "FAILED") {
      return { status: "TERMINAL" };
    }

    if (
      message?.applicationId !== input.applicationId ||
      message.integrationId !== input.integrationId ||
      message.messageId !== input.messageId ||
      typeof message.chatId !== "string" ||
      typeof message.text !== "string"
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
      integration.provider !== "TELEGRAM" ||
      typeof integration.providerConnectionId !== "string"
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
      typeof providerConnection.secretArn !== "string"
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
          },
          Key: messageKey,
          TableName: this.#dataTable,
          UpdateExpression: "SET #status = :processing, processingAt = :processingAt",
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }

      const current = await this.#get(this.#dataTable, messageKey);

      if (current?.status === "SENT" || current?.status === "FAILED") {
        return { status: "TERMINAL" };
      }

      throw new ApplicationError(
        "PROVIDER_UNAVAILABLE",
        "The Telegram message is already being processed.",
        503,
        true,
      );
    }

    return {
      chatId: message.chatId,
      conversationId: reference.conversationId,
      messageSortKey: reference.messageSortKey,
      secretArn: providerConnection.secretArn,
      status: "CLAIMED",
      text: message.text,
    };
  }

  public async markSent(input: {
    conversationId: string;
    messageSortKey: string;
    providerMessageId: string;
    sentAt: string;
  }): Promise<void> {
    await this.#setStatus(
      input,
      "SENT",
      {
        ":providerMessageId": input.providerMessageId,
        ":sentAt": input.sentAt,
      },
      "providerMessageId = :providerMessageId, sentAt = :sentAt",
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
      },
      "failedAt = :failedAt, failureCode = :failureCode",
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
      },
      "lastRetryAt = :releasedAt",
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
        },
        Key,
        TableName: this.#dataTable,
        UpdateExpression: "SET #status = :failed, failedAt = :failedAt, failureCode = :failureCode",
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
    status: "FAILED" | "QUEUED" | "SENT",
    additionalValues: Record<string, string>,
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
