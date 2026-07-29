import { createHash } from "node:crypto";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchWriteCommand, DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type { ConversationStore } from "../../application/ports/conversation-store.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

interface DeleteWrite {
  DeleteRequest: {
    Key: {
      PK: string;
      SK: string;
    };
  };
}

const storedMessageSchema = z.looseObject({
  PK: z.string().min(1),
  SK: z.string().min(1),
  applicationId: z.string().min(1),
  conversationId: z.string().min(1),
  integrationId: z.string().min(1),
  messageId: z.string().min(1),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerMessageId: z.string().min(1).optional(),
  tenantId: z.string().min(1),
});

export class DynamoConversationStore implements ConversationStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;

  public constructor(client: DynamoDBDocumentClient, controlTable: string, dataTable: string) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
  }

  public async deleteConversation(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<void> {
    for (;;) {
      const conversation = await this.#getConversation(input.conversationId);

      if (conversation === undefined) return;
      if (
        conversation.applicationId !== input.applicationId ||
        conversation.tenantId !== input.tenantId
      ) {
        throw conversationNotFoundError();
      }
      if (typeof conversation.lastMessageAt !== "string") {
        throw new Error("Conversation metadata is inconsistent.");
      }

      await this.#deleteStoredMessages(input);

      try {
        await this.#client.send(
          new DeleteCommand({
            ConditionExpression:
              "applicationId = :applicationId AND tenantId = :tenantId " +
              "AND lastMessageAt = :lastMessageAt",
            ExpressionAttributeValues: {
              ":applicationId": input.applicationId,
              ":lastMessageAt": conversation.lastMessageAt,
              ":tenantId": input.tenantId,
            },
            Key: {
              PK: `CONVERSATION#${input.conversationId}`,
              SK: "META",
            },
            TableName: this.#controlTable,
          }),
        );
        return;
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      }
    }
  }

  async #deleteStoredMessages(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<void> {
    const partitionKey = `CONVERSATION#${input.conversationId}`;

    for (;;) {
      const response = await this.#client.send(
        new QueryCommand({
          ConsistentRead: true,
          ExpressionAttributeValues: {
            ":messagePrefix": "MESSAGE#",
            ":partitionKey": partitionKey,
          },
          KeyConditionExpression: "PK = :partitionKey AND begins_with(SK, :messagePrefix)",
          ProjectionExpression:
            "PK, SK, applicationId, conversationId, integrationId, messageId, " +
            "provider, providerMessageId, tenantId",
          TableName: this.#dataTable,
        }),
      );
      const messages = z.array(storedMessageSchema).parse(response.Items ?? []);

      if (messages.length === 0) return;

      const writes = new Map<string, DeleteWrite>();
      const addDelete = (PK: string, SK: string): void => {
        writes.set(`${PK}\u0000${SK}`, {
          DeleteRequest: {
            Key: { PK, SK },
          },
        });
      };

      for (const message of messages) {
        if (
          message.PK !== partitionKey ||
          message.applicationId !== input.applicationId ||
          message.conversationId !== input.conversationId ||
          message.tenantId !== input.tenantId
        ) {
          throw new Error("Conversation message metadata is inconsistent.");
        }

        addDelete(message.PK, message.SK);
        addDelete(`MESSAGE#${message.messageId}`, "REF");

        if (message.providerMessageId !== undefined) {
          addDelete(
            `PROVIDER_MESSAGE#${message.provider}#${message.integrationId}#${sha256(
              message.providerMessageId,
            )}`,
            "REF",
          );
        }
      }

      await this.#batchDelete([...writes.values()]);
    }
  }

  async #batchDelete(writes: DeleteWrite[]): Promise<void> {
    for (let index = 0; index < writes.length; index += 25) {
      let pending: DeleteWrite[] = writes.slice(index, index + 25);

      for (let attempt = 0; pending.length > 0; attempt += 1) {
        const response = await this.#client.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.#dataTable]: pending,
            },
          }),
        );
        pending = (response.UnprocessedItems?.[this.#dataTable] ?? []) as DeleteWrite[];

        if (pending.length > 0) {
          if (attempt >= 7) {
            throw new Error("DynamoDB did not process all conversation message deletions.");
          }

          await delay(2 ** attempt * 10);
        }
      }
    }
  }

  async #getConversation(conversationId: string): Promise<Record<string, unknown> | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `CONVERSATION#${conversationId}`,
          SK: "META",
        },
        TableName: this.#controlTable,
      }),
    );

    return response.Item;
  }
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const conversationNotFoundError = (): ApplicationError =>
  new ApplicationError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
