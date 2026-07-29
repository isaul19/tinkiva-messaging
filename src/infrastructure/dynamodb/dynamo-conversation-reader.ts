import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  ConversationMessagePage,
  ConversationPage,
  ConversationReader,
} from "../../application/ports/conversation-reader.js";
import type {
  ConversationListItem,
  ConversationMessage,
} from "../../contracts/api/conversation.contract.js";
import type { MediaUrlSigner } from "../../application/ports/media.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { conversationIndexPartitionKey } from "./conversation-index.js";

const conversationRecordSchema = z.looseObject({
  applicationId: z.string().min(1),
  conversationId: z.string().min(1),
  createdAt: z.iso.datetime(),
  identityId: z.string().min(1),
  integrationId: z.string().min(1),
  lastMessageAt: z.iso.datetime(),
  status: z.enum(["OPEN", "CLOSED"]),
  tenantId: z.string().min(1),
});

const identityRecordSchema = z.looseObject({
  canonicalType: z.enum(["TELEGRAM_CHAT_ID", "WHATSAPP_BSUID", "WHATSAPP_PHONE"]),
  canonicalValue: z.string().min(1),
  displayName: z.string().min(1),
  integrationId: z.string().min(1),
  phoneE164: z.string().min(1).nullable().optional(),
  username: z.string().min(1).nullable().optional(),
});

const messageRecordSchema = z.looseObject({
  caption: z.string().max(1_024).optional(),
  conversationId: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  failureCode: z.string().min(1).optional(),
  integrationId: z.string().min(1),
  messageId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"]),
  tenantId: z.string().min(1),
  media: z
    .object({
      bucket: z.string().min(1),
      key: z.string().min(1),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().positive(),
    })
    .optional(),
  text: z.string().optional(),
  type: z.enum(["IMAGE", "TEXT"]),
});

const conversationCursorSchema = z.strictObject({
  GSI1PK: z.string().min(1),
  GSI1SK: z.string().min(1),
  PK: z.string().min(1),
  SK: z.string().min(1),
});

const messageCursorSchema = z.strictObject({
  PK: z.string().min(1),
  SK: z.string().min(1),
});

export class DynamoConversationReader implements ConversationReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #dataTable: string;
  readonly #media: MediaUrlSigner;

  public constructor(
    client: DynamoDBDocumentClient,
    controlTable: string,
    dataTable: string,
    media: MediaUrlSigner,
  ) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#dataTable = dataTable;
    this.#media = media;
  }

  public async listConversations(input: {
    applicationId: string;
    cursor?: string;
    integrationId: string;
    limit: number;
    tenantId: string;
  }): Promise<ConversationPage> {
    await this.#requireIntegration(input);
    const partitionKey = conversationIndexPartitionKey(
      input.applicationId,
      input.tenantId,
      input.integrationId,
    );
    const exclusiveStartKey =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor, conversationCursorSchema);

    if (exclusiveStartKey !== undefined && exclusiveStartKey.GSI1PK !== partitionKey) {
      throw invalidCursorError();
    }

    const response = await this.#client.send(
      new QueryCommand({
        ExclusiveStartKey: exclusiveStartKey,
        ExpressionAttributeValues: {
          ":partitionKey": partitionKey,
        },
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :partitionKey",
        Limit: input.limit,
        ScanIndexForward: false,
        TableName: this.#controlTable,
      }),
    );
    const conversations = z.array(conversationRecordSchema).parse(response.Items ?? []);
    const items = await Promise.all(
      conversations.map((conversation) => this.#toConversationListItem(conversation, input)),
    );

    return {
      items,
      ...(response.LastEvaluatedKey === undefined
        ? {}
        : {
            nextCursor: encodeCursor(conversationCursorSchema.parse(response.LastEvaluatedKey)),
          }),
    };
  }

  public async listMessages(input: {
    applicationId: string;
    conversationId: string;
    cursor?: string;
    limit: number;
    tenantId: string;
  }): Promise<ConversationMessagePage> {
    const conversation = await this.#getConversation(input.conversationId);
    if (
      conversation.applicationId !== input.applicationId ||
      conversation.tenantId !== input.tenantId
    ) {
      throw conversationNotFoundError();
    }
    const partitionKey = `CONVERSATION#${input.conversationId}`;
    const exclusiveStartKey =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor, messageCursorSchema);

    if (exclusiveStartKey !== undefined && exclusiveStartKey.PK !== partitionKey) {
      throw invalidCursorError();
    }

    const response = await this.#client.send(
      new QueryCommand({
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
        ExpressionAttributeValues: {
          ":messagePrefix": "MESSAGE#",
          ":partitionKey": partitionKey,
        },
        KeyConditionExpression: "PK = :partitionKey AND begins_with(SK, :messagePrefix)",
        Limit: input.limit,
        ScanIndexForward: false,
        TableName: this.#dataTable,
      }),
    );
    const messages = z.array(messageRecordSchema).parse(response.Items ?? []);

    for (const message of messages) {
      if (message.conversationId !== input.conversationId || message.tenantId !== input.tenantId) {
        throw new Error("Conversation message metadata is inconsistent.");
      }
    }

    return {
      items: await Promise.all(
        messages.reverse().map((message) => this.#toConversationMessage(message)),
      ),
      ...(response.LastEvaluatedKey === undefined
        ? {}
        : {
            nextCursor: encodeCursor(messageCursorSchema.parse(response.LastEvaluatedKey)),
          }),
    };
  }

  async #requireIntegration(input: {
    applicationId: string;
    integrationId: string;
    tenantId: string;
  }): Promise<void> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `INTEGRATION#${input.integrationId}`,
          SK: "META",
        },
        TableName: this.#controlTable,
      }),
    );

    if (
      response.Item?.applicationId !== input.applicationId ||
      response.Item.tenantId !== input.tenantId
    ) {
      throw new ApplicationError(
        "INTEGRATION_NOT_FOUND",
        "The messaging integration was not found.",
        404,
      );
    }
  }

  async #getConversation(
    conversationId: string,
  ): Promise<z.infer<typeof conversationRecordSchema>> {
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
    const parsed = conversationRecordSchema.safeParse(response.Item);
    if (!parsed.success) throw conversationNotFoundError();
    return parsed.data;
  }

  async #toConversationListItem(
    conversation: z.infer<typeof conversationRecordSchema>,
    input: {
      applicationId: string;
      integrationId: string;
      tenantId: string;
    },
  ): Promise<ConversationListItem> {
    if (
      conversation.applicationId !== input.applicationId ||
      conversation.integrationId !== input.integrationId ||
      conversation.tenantId !== input.tenantId
    ) {
      throw new Error("Conversation index metadata is inconsistent.");
    }

    const [identityResponse, messageResponse] = await Promise.all([
      this.#client.send(
        new GetCommand({
          ConsistentRead: true,
          Key: {
            PK: `IDENTITY#${conversation.identityId}`,
            SK: "META",
          },
          TableName: this.#controlTable,
        }),
      ),
      this.#client.send(
        new QueryCommand({
          ConsistentRead: true,
          ExpressionAttributeValues: {
            ":messagePrefix": "MESSAGE#",
            ":partitionKey": `CONVERSATION#${conversation.conversationId}`,
          },
          KeyConditionExpression: "PK = :partitionKey AND begins_with(SK, :messagePrefix)",
          Limit: 1,
          ScanIndexForward: false,
          TableName: this.#dataTable,
        }),
      ),
    ]);
    const identity = identityRecordSchema.parse(identityResponse.Item);
    const message = messageResponse.Items?.[0];
    const parsedMessage = message === undefined ? undefined : messageRecordSchema.parse(message);
    const provider =
      identity.canonicalType === "TELEGRAM_CHAT_ID" ? ("TELEGRAM" as const) : ("WHATSAPP" as const);

    if (identity.integrationId !== conversation.integrationId) {
      throw new Error("Conversation identity metadata is inconsistent.");
    }

    return {
      conversationId: conversation.conversationId,
      createdAt: conversation.createdAt,
      integrationId: conversation.integrationId,
      ...(parsedMessage === undefined
        ? {}
        : { lastMessage: await this.#toConversationMessage(parsedMessage) }),
      lastMessageAt: conversation.lastMessageAt,
      participant: {
        displayName: identity.displayName,
        ...(identity.phoneE164 == null ? {} : { phoneNumber: identity.phoneE164 }),
        ...(identity.username == null ? {} : { username: identity.username }),
      },
      provider,
      status: conversation.status,
      tenantId: conversation.tenantId,
    };
  }

  async #toConversationMessage(
    message: z.infer<typeof messageRecordSchema>,
  ): Promise<ConversationMessage> {
    const common = {
      conversationId: message.conversationId,
      direction: message.direction,
      ...(message.failureCode === undefined ? {} : { failureCode: message.failureCode }),
      integrationId: message.integrationId,
      messageId: message.messageId,
      occurredAt: message.occurredAt,
      provider: message.provider,
      status: message.status,
    };
    if (message.type === "TEXT") {
      if (message.text === undefined) throw new Error("Text message content is missing.");
      return { ...common, text: message.text, type: "TEXT" };
    }
    if (message.media === undefined) throw new Error("Image message content is missing.");
    return {
      ...common,
      ...(message.caption === undefined ? {} : { caption: message.caption }),
      media: {
        mediaId: message.media.key,
        mimeType: message.media.mimeType,
        sha256: message.media.sha256,
        sizeBytes: message.media.sizeBytes,
        url: await this.#media.temporaryDownloadUrl(message.media),
      },
      type: "IMAGE",
    };
  }
}

const encodeCursor = (value: Record<string, string>): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decodeCursor = <T extends z.ZodType<Record<string, string>>>(
  cursor: string,
  schema: T,
): z.infer<T> => {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown);
  } catch {
    throw invalidCursorError();
  }
};

const invalidCursorError = (): ApplicationError =>
  new ApplicationError("PAGINATION_CURSOR_INVALID", "The pagination cursor is invalid.", 400);

const conversationNotFoundError = (): ApplicationError =>
  new ApplicationError("CONVERSATION_NOT_FOUND", "The conversation was not found.", 404);
