import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  PlatformAdminStore,
  PlatformIntegrationAdministrationItem,
  PlatformIntegrationAdministrationPage,
  PlatformIntegrationDeletionResult,
} from "../../application/ports/platform-admin-store.js";
import type { MediaObjectDeleter } from "../../application/ports/media.js";
import {
  openAiCredentialStatusSchema,
  type InboundMediaConfiguration,
} from "../../contracts/api/platform-admin.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { conversationIndexPartitionKey } from "./conversation-index.js";
import { DynamoConversationStore } from "./dynamo-conversation-store.js";

const SCAN_PAGE_SIZE = 250;
const CONVERSATIONS_PER_DELETION_REQUEST = 10;
const COUNT_CONCURRENCY = 8;

const inboundMediaSchema = z.strictObject({
  audioAlternativeText: z.boolean(),
  imageAlternativeText: z.boolean(),
});

const integrationSchema = z.looseObject({
  PK: z.string().min(1),
  SK: z.literal("META"),
  applicationId: z.string().min(1),
  botId: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  displayName: z.string().min(1),
  entityType: z.literal("CHANNEL_INTEGRATION"),
  inboundMedia: inboundMediaSchema.optional(),
  integrationId: z.string().min(1),
  openAiCredential: openAiCredentialStatusSchema.optional(),
  phoneNumberId: z.string().min(1).optional(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerAccountId: z.string().min(1),
  providerConnectionId: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]),
  tenantId: z.string().min(1),
  updatedAt: z.iso.datetime().optional(),
  wabaId: z.string().min(1).optional(),
});

const connectionSchema = z.looseObject({
  PK: z.string().min(1),
  SK: z.literal("META"),
  applicationId: z.string().min(1),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerConnectionId: z.string().min(1),
  tenantId: z.string().min(1),
  webhookKey: z.string().min(1),
});

const conversationSchema = z.looseObject({
  PK: z.string().min(1),
  SK: z.literal("META"),
  applicationId: z.string().min(1),
  conversationId: z.string().min(1),
  integrationId: z.string().min(1),
  tenantId: z.string().min(1),
});

const integrationChildSchema = z.looseObject({
  PK: z.string().min(1),
  SK: z.string().min(1),
  identityId: z.string().min(1).optional(),
});

const scanCursorSchema = z.strictObject({
  PK: z.string().min(1),
  SK: z.string().min(1),
});

interface DeleteWrite {
  DeleteRequest: {
    Key: {
      PK: string;
      SK: string;
    };
  };
}

export class DynamoPlatformAdminStore implements PlatformAdminStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #conversationStore: DynamoConversationStore;

  public constructor(
    client: DynamoDBDocumentClient,
    controlTable: string,
    dataTable: string,
    media?: MediaObjectDeleter,
  ) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#conversationStore = new DynamoConversationStore(client, controlTable, dataTable, media);
  }

  public async listIntegrations(input: {
    cursor?: string;
  }): Promise<PlatformIntegrationAdministrationPage> {
    const exclusiveStartKey =
      input.cursor === undefined ? undefined : decodeCursor(input.cursor, scanCursorSchema);
    const response = await this.#client.send(
      new ScanCommand({
        ConsistentRead: true,
        ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":entityType": "CHANNEL_INTEGRATION",
        },
        FilterExpression: "entityType = :entityType",
        Limit: SCAN_PAGE_SIZE,
        ProjectionExpression:
          "PK, SK, applicationId, createdAt, displayName, entityType, inboundMedia, " +
          "integrationId, openAiCredential, provider, providerAccountId, providerConnectionId, #status, " +
          "tenantId, updatedAt, botId, phoneNumberId, wabaId",
        TableName: this.#controlTable,
      }),
    );
    const integrations = z.array(integrationSchema).parse(response.Items ?? []);
    const items = await mapWithConcurrency(
      integrations,
      COUNT_CONCURRENCY,
      async (integration): Promise<PlatformIntegrationAdministrationItem> => ({
        applicationId: integration.applicationId,
        chatCount: await this.#countConversations(integration),
        createdAt: integration.createdAt,
        displayName: integration.displayName,
        inboundMedia: integration.inboundMedia ?? defaultInboundMedia(),
        integrationId: integration.integrationId,
        openAiCredential: integration.openAiCredential ?? { configured: false },
        provider: integration.provider,
        providerAccountId: integration.providerAccountId,
        status: integration.status,
        tenantId: integration.tenantId,
        ...(integration.updatedAt === undefined ? {} : { updatedAt: integration.updatedAt }),
      }),
    );

    return {
      items: items.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      ...(response.LastEvaluatedKey === undefined
        ? {}
        : { nextCursor: encodeCursor(scanCursorSchema.parse(response.LastEvaluatedKey)) }),
    };
  }

  public async updateInboundMedia(input: {
    applicationId: string;
    inboundMedia: InboundMediaConfiguration;
    integrationId: string;
    tenantId: string;
  }): Promise<{ inboundMedia: InboundMediaConfiguration; updatedAt: string }> {
    const updatedAt = new Date().toISOString();
    const requiresCredential =
      input.inboundMedia.audioAlternativeText || input.inboundMedia.imageAlternativeText;

    try {
      if (requiresCredential) {
        await this.#updateInboundMediaWithCredentialCondition(input, updatedAt);
      } else {
        await this.#client.send(
          new UpdateCommand({
            ConditionExpression:
              "applicationId = :applicationId AND tenantId = :tenantId " +
              "AND integrationId = :integrationId AND entityType = :entityType",
            ExpressionAttributeValues: {
              ":applicationId": input.applicationId,
              ":entityType": "CHANNEL_INTEGRATION",
              ":inboundMedia": input.inboundMedia,
              ":integrationId": input.integrationId,
              ":tenantId": input.tenantId,
              ":updatedAt": updatedAt,
            },
            Key: {
              PK: `INTEGRATION#${input.integrationId}`,
              SK: "META",
            },
            TableName: this.#controlTable,
            UpdateExpression: "SET inboundMedia = :inboundMedia, updatedAt = :updatedAt",
          }),
        );
      }
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw integrationNotFoundError();
      if (error instanceof TransactionCanceledException) {
        const reasons = error.CancellationReasons ?? [];
        if (reasons[1]?.Code === "ConditionalCheckFailed") throw integrationNotFoundError();
        if (reasons[0]?.Code === "ConditionalCheckFailed") throw credentialRequiredError();
      }
      throw error;
    }

    return { inboundMedia: input.inboundMedia, updatedAt };
  }

  async #updateInboundMediaWithCredentialCondition(
    input: {
      applicationId: string;
      inboundMedia: InboundMediaConfiguration;
      integrationId: string;
      tenantId: string;
    },
    updatedAt: string,
  ): Promise<void> {
    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              ConditionExpression:
                "applicationId = :applicationId AND tenantId = :tenantId " +
                "AND integrationId = :integrationId AND entityType = :credentialEntityType " +
                "AND attribute_exists(credentialCiphertext) " +
                "AND attribute_exists(credentialKeyArn) " +
                "AND credentialVersion >= :minimumCredentialVersion",
              ExpressionAttributeValues: {
                ":applicationId": input.applicationId,
                ":credentialEntityType": "OPENAI_CREDENTIAL",
                ":integrationId": input.integrationId,
                ":minimumCredentialVersion": 1,
                ":tenantId": input.tenantId,
              },
              Key: {
                PK: `INTEGRATION#${input.integrationId}`,
                SK: "OPENAI_CREDENTIAL",
              },
              TableName: this.#controlTable,
            },
          },
          {
            Update: {
              ConditionExpression:
                "applicationId = :applicationId AND tenantId = :tenantId " +
                "AND integrationId = :integrationId AND entityType = :entityType",
              ExpressionAttributeValues: {
                ":applicationId": input.applicationId,
                ":entityType": "CHANNEL_INTEGRATION",
                ":inboundMedia": input.inboundMedia,
                ":integrationId": input.integrationId,
                ":tenantId": input.tenantId,
                ":updatedAt": updatedAt,
              },
              Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
              TableName: this.#controlTable,
              UpdateExpression: "SET inboundMedia = :inboundMedia, updatedAt = :updatedAt",
            },
          },
        ],
      }),
    );
  }

  public async deleteIntegrationData(input: {
    applicationId: string;
    integrationId: string;
    mode: "CHATS_ONLY" | "INTEGRATION_AND_CHATS";
    tenantId: string;
  }): Promise<PlatformIntegrationDeletionResult> {
    const integration = await this.#getIntegration(input.integrationId);

    if (integration === undefined) {
      if (input.mode === "INTEGRATION_AND_CHATS") return completedDeletion(input, 0);
      throw integrationNotFoundError();
    }
    this.#assertOwnership(integration, input);

    let connection: z.infer<typeof connectionSchema> | undefined;
    if (input.mode === "INTEGRATION_AND_CHATS") {
      connection = await this.#getConnection(integration);
      if (integration.status !== "DISABLED") {
        await this.#disableIntegration(integration, connection);
      }
    }

    const page = await this.#listConversationDeletionCandidates(integration);
    const candidates = page.items.slice(0, CONVERSATIONS_PER_DELETION_REQUEST);
    const deletionStatuses = await mapWithConcurrency(candidates, 2, async (conversation) => {
      return this.#conversationStore.deleteConversationPage({
        applicationId: conversation.applicationId,
        conversationId: conversation.conversationId,
        tenantId: conversation.tenantId,
      });
    });
    const deletedChats = deletionStatuses.filter((status) => status === "COMPLETED").length;

    const needsAnotherPass =
      page.items.length > CONVERSATIONS_PER_DELETION_REQUEST ||
      page.hasMore ||
      candidates.length === CONVERSATIONS_PER_DELETION_REQUEST ||
      deletionStatuses.some((status) => status === "IN_PROGRESS");
    if (needsAnotherPass) {
      return {
        deletedChats,
        integrationId: input.integrationId,
        mode: input.mode,
        status: "IN_PROGRESS",
      };
    }

    // A non-empty GSI page does not prove that an eventually-consistent index exposed every
    // recent conversation. Require a second request, whose empty GSI result triggers the
    // consistent table scan below, before reporting a destructive operation complete.
    if (candidates.length > 0) {
      return {
        deletedChats,
        integrationId: input.integrationId,
        mode: input.mode,
        status: "IN_PROGRESS",
      };
    }

    if (input.mode === "CHATS_ONLY") return completedDeletion(input, candidates.length);
    if (connection === undefined) throw new Error("Provider connection metadata is missing.");

    await this.#deleteIntegrationRecords(integration, connection);
    return completedDeletion(input, candidates.length);
  }

  async #countConversations(integration: z.infer<typeof integrationSchema>): Promise<number> {
    const partitionKey = conversationIndexPartitionKey(
      integration.applicationId,
      integration.tenantId,
      integration.integrationId,
    );
    let count = 0;
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.#client.send(
        new QueryCommand({
          ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
          ExpressionAttributeValues: {
            ":partitionKey": partitionKey,
          },
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :partitionKey",
          Select: "COUNT",
          TableName: this.#controlTable,
        }),
      );
      count += response.Count ?? 0;
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);

    return count;
  }

  async #getIntegration(
    integrationId: string,
  ): Promise<z.infer<typeof integrationSchema> | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { PK: `INTEGRATION#${integrationId}`, SK: "META" },
        TableName: this.#controlTable,
      }),
    );
    if (response.Item === undefined) return undefined;
    const parsed = integrationSchema.safeParse(response.Item);
    if (!parsed.success || parsed.data.integrationId !== integrationId) {
      throw new Error("Integration metadata is inconsistent.");
    }
    return parsed.data;
  }

  async #getConnection(
    integration: z.infer<typeof integrationSchema>,
  ): Promise<z.infer<typeof connectionSchema>> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `PROVIDER_CONNECTION#${integration.providerConnectionId}`,
          SK: "META",
        },
        TableName: this.#controlTable,
      }),
    );
    const connection = connectionSchema.safeParse(response.Item);
    if (
      !connection.success ||
      connection.data.applicationId !== integration.applicationId ||
      connection.data.tenantId !== integration.tenantId ||
      connection.data.provider !== integration.provider ||
      connection.data.providerConnectionId !== integration.providerConnectionId
    ) {
      throw new Error("Provider connection metadata is inconsistent.");
    }
    return connection.data;
  }

  #assertOwnership(
    integration: z.infer<typeof integrationSchema>,
    input: { applicationId: string; integrationId: string; tenantId: string },
  ): void {
    if (
      integration.applicationId !== input.applicationId ||
      integration.integrationId !== input.integrationId ||
      integration.tenantId !== input.tenantId
    ) {
      throw integrationNotFoundError();
    }
  }

  async #disableIntegration(
    integration: z.infer<typeof integrationSchema>,
    connection: z.infer<typeof connectionSchema>,
  ): Promise<void> {
    const keys = [
      { PK: integration.PK, SK: integration.SK },
      { PK: connection.PK, SK: connection.SK },
      {
        PK: `TENANT#${integration.tenantId}`,
        SK: `INTEGRATION#${integration.provider}#${integration.integrationId}`,
      },
      { PK: `WEBHOOK#${integration.provider}#${connection.webhookKey}`, SK: "REF" },
      ...(integration.provider === "WHATSAPP"
        ? [
            { PK: `WHATSAPP_WABA#${requireValue(integration.wabaId, "wabaId")}`, SK: "REF" },
            {
              PK: `WHATSAPP_PHONE_NUMBER#${requireValue(
                integration.phoneNumberId,
                "phoneNumberId",
              )}`,
              SK: "REF",
            },
          ]
        : []),
    ];
    const updatedAt = new Date().toISOString();

    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: keys.map((Key) => ({
          Update: {
            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": "DISABLED",
              ":updatedAt": updatedAt,
            },
            Key,
            TableName: this.#controlTable,
            UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
          },
        })),
      }),
    );
  }

  async #listConversationDeletionCandidates(
    integration: z.infer<typeof integrationSchema>,
  ): Promise<{ hasMore: boolean; items: z.infer<typeof conversationSchema>[] }> {
    const response = await this.#client.send(
      new QueryCommand({
        ExpressionAttributeValues: {
          ":partitionKey": conversationIndexPartitionKey(
            integration.applicationId,
            integration.tenantId,
            integration.integrationId,
          ),
        },
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :partitionKey",
        Limit: CONVERSATIONS_PER_DELETION_REQUEST + 1,
        ProjectionExpression: "PK, SK, applicationId, conversationId, integrationId, tenantId",
        TableName: this.#controlTable,
      }),
    );
    const items = z.array(conversationSchema).parse(response.Items ?? []);
    for (const conversation of items) {
      if (
        conversation.applicationId !== integration.applicationId ||
        conversation.integrationId !== integration.integrationId ||
        conversation.tenantId !== integration.tenantId
      ) {
        throw new Error("Conversation index metadata is inconsistent.");
      }
    }
    if (items.length > 0 || response.LastEvaluatedKey !== undefined) {
      return { hasMore: response.LastEvaluatedKey !== undefined, items };
    }

    // GSI reads are eventually consistent. Before declaring a purge complete, use a
    // strongly consistent table scan so a newly-created or pre-backfill chat cannot be orphaned.
    const fallbackItems: z.infer<typeof conversationSchema>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const fallback = await this.#client.send(
        new ScanCommand({
          ConsistentRead: true,
          ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
          ExpressionAttributeValues: {
            ":applicationId": integration.applicationId,
            ":entityType": "CONVERSATION",
            ":integrationId": integration.integrationId,
            ":tenantId": integration.tenantId,
          },
          FilterExpression:
            "entityType = :entityType AND applicationId = :applicationId AND " +
            "tenantId = :tenantId AND integrationId = :integrationId",
          ProjectionExpression: "PK, SK, applicationId, conversationId, integrationId, tenantId",
          TableName: this.#controlTable,
        }),
      );
      fallbackItems.push(...z.array(conversationSchema).parse(fallback.Items ?? []));
      exclusiveStartKey = fallback.LastEvaluatedKey;
    } while (
      exclusiveStartKey !== undefined &&
      fallbackItems.length <= CONVERSATIONS_PER_DELETION_REQUEST
    );

    return {
      hasMore:
        exclusiveStartKey !== undefined ||
        fallbackItems.length > CONVERSATIONS_PER_DELETION_REQUEST,
      items: fallbackItems.slice(0, CONVERSATIONS_PER_DELETION_REQUEST + 1),
    };
  }

  async #deleteIntegrationRecords(
    integration: z.infer<typeof integrationSchema>,
    connection: z.infer<typeof connectionSchema>,
  ): Promise<void> {
    const children: z.infer<typeof integrationChildSchema>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.#client.send(
        new QueryCommand({
          ConsistentRead: true,
          ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
          ExpressionAttributeValues: { ":partitionKey": integration.PK },
          KeyConditionExpression: "PK = :partitionKey",
          ProjectionExpression: "PK, SK, identityId",
          TableName: this.#controlTable,
        }),
      );
      children.push(...z.array(integrationChildSchema).parse(response.Items ?? []));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);

    const identityIds = [
      ...new Set(
        children.flatMap((child) => (child.identityId === undefined ? [] : [child.identityId])),
      ),
    ];
    const baseKeys = [
      {
        PK: `TENANT#${integration.tenantId}`,
        SK: `INTEGRATION#${integration.provider}#${integration.integrationId}`,
      },
      { PK: `WEBHOOK#${integration.provider}#${connection.webhookKey}`, SK: "REF" },
      {
        PK: `PROVIDER_CONNECTION#${integration.providerConnectionId}`,
        SK: "CREDENTIAL",
      },
      ...(integration.provider === "TELEGRAM"
        ? [
            {
              PK: `TELEGRAM_BOT#${requireValue(integration.botId, "botId")}`,
              SK: "REF",
            },
          ]
        : [
            { PK: `WHATSAPP_WABA#${requireValue(integration.wabaId, "wabaId")}`, SK: "REF" },
            {
              PK: `WHATSAPP_PHONE_NUMBER#${requireValue(
                integration.phoneNumberId,
                "phoneNumberId",
              )}`,
              SK: "REF",
            },
          ]),
    ];
    // Delete data derived from integration children before deleting those source children. If a
    // request is interrupted, the next attempt can still reconstruct every remaining dependency.
    await this.#batchDelete(
      this.#controlTable,
      identityIds.map((identityId) => ({ PK: `IDENTITY#${identityId}`, SK: "META" })),
    );
    await this.#batchDelete(this.#controlTable, baseKeys);
    await this.#batchDelete(
      this.#controlTable,
      children.filter((child) => child.SK !== "META").map(({ PK, SK }) => ({ PK, SK })),
    );

    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              ConditionExpression:
                "applicationId = :applicationId AND tenantId = :tenantId " +
                "AND integrationId = :integrationId AND providerConnectionId = :connectionId",
              ExpressionAttributeValues: {
                ":applicationId": integration.applicationId,
                ":connectionId": integration.providerConnectionId,
                ":integrationId": integration.integrationId,
                ":tenantId": integration.tenantId,
              },
              Key: { PK: integration.PK, SK: integration.SK },
              TableName: this.#controlTable,
            },
          },
          {
            Delete: {
              ConditionExpression:
                "applicationId = :applicationId AND tenantId = :tenantId " +
                "AND providerConnectionId = :connectionId",
              ExpressionAttributeValues: {
                ":applicationId": integration.applicationId,
                ":connectionId": integration.providerConnectionId,
                ":tenantId": integration.tenantId,
              },
              Key: { PK: connection.PK, SK: connection.SK },
              TableName: this.#controlTable,
            },
          },
          {
            Delete: {
              Key: { PK: integration.PK, SK: "OPENAI_CREDENTIAL" },
              TableName: this.#controlTable,
            },
          },
        ],
      }),
    );
  }

  async #batchDelete(tableName: string, keys: { PK: string; SK: string }[]): Promise<void> {
    if (keys.length === 0) return;
    const unique = new Map(keys.map((Key) => [`${Key.PK}\u0000${Key.SK}`, Key]));
    const writes: DeleteWrite[] = [...unique.values()].map((Key) => ({ DeleteRequest: { Key } }));

    for (let index = 0; index < writes.length; index += 25) {
      let pending = writes.slice(index, index + 25);

      for (let attempt = 0; pending.length > 0; attempt += 1) {
        const response = await this.#client.send(
          new BatchWriteCommand({ RequestItems: { [tableName]: pending } }),
        );
        pending = (response.UnprocessedItems?.[tableName] ?? []) as DeleteWrite[];
        if (pending.length > 0) {
          if (attempt >= 7) throw new Error("DynamoDB did not process all admin deletions.");
          await delay(2 ** attempt * 10);
        }
      }
    }
  }
}

const defaultInboundMedia = (): InboundMediaConfiguration => ({
  audioAlternativeText: false,
  imageAlternativeText: false,
});

const encodeCursor = (value: Record<string, string>): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decodeCursor = <T extends z.ZodType<Record<string, string>>>(
  cursor: string,
  schema: T,
): z.infer<T> => {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown);
  } catch {
    throw new ApplicationError(
      "PAGINATION_CURSOR_INVALID",
      "The pagination cursor is invalid.",
      400,
    );
  }
};

const mapWithConcurrency = async <T, TResult>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<TResult>,
): Promise<TResult[]> => {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
};

const completedDeletion = (
  input: { integrationId: string; mode: "CHATS_ONLY" | "INTEGRATION_AND_CHATS" },
  deletedChats: number,
): PlatformIntegrationDeletionResult => ({
  deletedChats,
  integrationId: input.integrationId,
  mode: input.mode,
  status: "COMPLETED",
});

const requireValue = (value: string | undefined, field: string): string => {
  if (value === undefined) throw new Error(`Integration ${field} metadata is missing.`);
  return value;
};

const integrationNotFoundError = (): ApplicationError =>
  new ApplicationError("INTEGRATION_NOT_FOUND", "The messaging integration was not found.", 404);

const credentialRequiredError = (): ApplicationError =>
  new ApplicationError(
    "OPENAI_CREDENTIAL_REQUIRED",
    "Configure an OpenAI credential before enabling inbound media enrichment.",
    409,
  );

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
