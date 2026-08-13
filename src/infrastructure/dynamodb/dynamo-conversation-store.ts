import { createHash } from "node:crypto";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchWriteCommand, DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type { ConversationStore } from "../../application/ports/conversation-store.js";
import type { MediaObjectDeleter, MediaReference } from "../../application/ports/media.js";
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
  media: z
    .object({
      bucket: z.string().min(1),
      key: z.string().min(1),
      mimeType: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().positive(),
    })
    .optional(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerMessageId: z.string().min(1).optional(),
  tenantId: z.string().min(1),
});

const MESSAGES_PER_DELETION_PAGE = 25;

export type ConversationDeletionPageStatus = "COMPLETED" | "IN_PROGRESS";

export class DynamoConversationStore implements ConversationStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;
  readonly #media: MediaObjectDeleter | undefined;

  public constructor(
    client: DynamoDBDocumentClient,
    controlTable: string,
    dataTable: string,
    media?: MediaObjectDeleter,
  ) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
    this.#media = media;
  }

  public async deleteConversation(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<void> {
    while ((await this.deleteConversationPage(input)) === "IN_PROGRESS") {
      // The public deletion keeps its existing all-or-nothing behavior. Administrative purges
      // call the bounded page method directly so an API request cannot be monopolized by one chat.
    }
  }

  public async deleteConversationPage(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<ConversationDeletionPageStatus> {
    const conversation = await this.#getConversation(input.conversationId);

    if (conversation === undefined) return "COMPLETED";
    if (
      conversation.applicationId !== input.applicationId ||
      conversation.tenantId !== input.tenantId
    ) {
      throw conversationNotFoundError();
    }
    const lastMessageAt = conversation.lastMessageAt;
    if (typeof lastMessageAt !== "string")
      throw new Error("Conversation metadata is inconsistent.");

    const hasMoreMessages = await this.#deleteStoredMessagePage(input);
    if (hasMoreMessages) return "IN_PROGRESS";

    try {
      await this.#client.send(
        new DeleteCommand({
          ConditionExpression:
            "applicationId = :applicationId AND tenantId = :tenantId " +
            "AND lastMessageAt = :lastMessageAt",
          ExpressionAttributeValues: {
            ":applicationId": input.applicationId,
            ":lastMessageAt": lastMessageAt,
            ":tenantId": input.tenantId,
          },
          Key: {
            PK: `CONVERSATION#${input.conversationId}`,
            SK: "META",
          },
          TableName: this.#controlTable,
        }),
      );
      return "COMPLETED";
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      return "IN_PROGRESS";
    }
  }

  async #deleteStoredMessagePage(input: {
    applicationId: string;
    conversationId: string;
    tenantId: string;
  }): Promise<boolean> {
    const partitionKey = `CONVERSATION#${input.conversationId}`;
    const response = await this.#client.send(
      new QueryCommand({
        ConsistentRead: true,
        ExpressionAttributeValues: {
          ":messagePrefix": "MESSAGE#",
          ":partitionKey": partitionKey,
        },
        KeyConditionExpression: "PK = :partitionKey AND begins_with(SK, :messagePrefix)",
        Limit: MESSAGES_PER_DELETION_PAGE,
        ProjectionExpression:
          "PK, SK, applicationId, conversationId, integrationId, messageId, " +
          "media, provider, providerMessageId, tenantId",
        TableName: this.#dataTable,
      }),
    );
    const messages = z.array(storedMessageSchema).parse(response.Items ?? []);
    const messageWrites = new Map<string, DeleteWrite>();
    const referenceWrites = new Map<string, DeleteWrite>();
    const media: MediaReference[] = [];
    const addDelete = (writes: Map<string, DeleteWrite>, PK: string, SK: string): void => {
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

      addDelete(messageWrites, message.PK, message.SK);
      if (message.media !== undefined) media.push(message.media);
      addDelete(referenceWrites, `MESSAGE#${message.messageId}`, "REF");

      if (message.providerMessageId !== undefined) {
        addDelete(
          referenceWrites,
          `PROVIDER_MESSAGE#${message.provider}#${message.integrationId}#${sha256(
            message.providerMessageId,
          )}`,
          "REF",
        );
      }
    }

    if (media.length > 0) {
      await this.#media?.deleteMedia({
        applicationId: input.applicationId,
        media,
        tenantId: input.tenantId,
      });
    }
    // Delete reconstructable secondary references before their source messages. A retry can
    // then always derive any unfinished work from the still-present source rows.
    await this.#batchDelete([...referenceWrites.values()]);
    await this.#batchDelete([...messageWrites.values()]);

    return response.LastEvaluatedKey !== undefined;
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
