import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  RealtimeConnection,
  RealtimeConnectionStore,
} from "../../application/ports/realtime-connection-store.js";
import type {
  IssueRealtimeTicketRecord,
  RealtimeTicketStore,
} from "../../application/ports/realtime-ticket-store.js";

const ticketRecordSchema = z.looseObject({
  applicationId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  tenantId: z.string().min(1),
  ticketDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

const connectionRecordSchema = z.looseObject({
  applicationId: z.string().min(1),
  connectionId: z.string().min(1),
  expiresAt: z.number().int().positive(),
  tenantId: z.string().min(1),
});

export class DynamoRealtimeStore implements RealtimeTicketStore, RealtimeConnectionStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async issue(input: IssueRealtimeTicketRecord): Promise<void> {
    await this.#client.send(
      new PutCommand({
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        Item: {
          PK: ticketPartitionKey(input.ticketDigest),
          SK: "META",
          applicationId: input.applicationId,
          entityType: "REALTIME_TICKET",
          expiresAt: input.expiresAt,
          tenantId: input.tenantId,
          ticketDigest: input.ticketDigest,
        },
        TableName: this.#tableName,
      }),
    );
  }

  public async connect(input: {
    connectedAt: string;
    connectionId: string;
    expiresAt: number;
    nowEpochSeconds: number;
    ticketDigest: string;
  }): Promise<RealtimeConnection | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: ticketPartitionKey(input.ticketDigest),
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );
    const parsedTicket = ticketRecordSchema.safeParse(response.Item);

    if (!parsedTicket.success || parsedTicket.data.expiresAt < input.nowEpochSeconds) {
      return undefined;
    }

    const connection: RealtimeConnection = {
      applicationId: parsedTicket.data.applicationId,
      connectionId: input.connectionId,
      expiresAt: input.expiresAt,
      tenantId: parsedTicket.data.tenantId,
    };
    const item = {
      ...connection,
      connectedAt: input.connectedAt,
      entityType: "REALTIME_CONNECTION",
    };

    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                ConditionExpression:
                  "ticketDigest = :ticketDigest AND applicationId = :applicationId " +
                  "AND tenantId = :tenantId AND expiresAt >= :now",
                ExpressionAttributeValues: {
                  ":applicationId": connection.applicationId,
                  ":now": input.nowEpochSeconds,
                  ":tenantId": connection.tenantId,
                  ":ticketDigest": input.ticketDigest,
                },
                Key: {
                  PK: ticketPartitionKey(input.ticketDigest),
                  SK: "META",
                },
                TableName: this.#tableName,
              },
            },
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  ...item,
                  PK: scopePartitionKey(connection.applicationId, connection.tenantId),
                  SK: `CONNECTION#${connection.connectionId}`,
                },
                TableName: this.#tableName,
              },
            },
            {
              Put: {
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                Item: {
                  ...item,
                  PK: connectionPartitionKey(connection.connectionId),
                  SK: "META",
                },
                TableName: this.#tableName,
              },
            },
          ],
        }),
      );
    } catch (error) {
      if (error instanceof TransactionCanceledException) return undefined;
      throw error;
    }

    return connection;
  }

  public async disconnect(connectionId: string): Promise<void> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: connectionPartitionKey(connectionId),
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );
    const connection = connectionRecordSchema.safeParse(response.Item);

    if (!connection.success || connection.data.connectionId !== connectionId) return;

    await this.#client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              Key: {
                PK: scopePartitionKey(connection.data.applicationId, connection.data.tenantId),
                SK: `CONNECTION#${connectionId}`,
              },
              TableName: this.#tableName,
            },
          },
          {
            Delete: {
              Key: {
                PK: connectionPartitionKey(connectionId),
                SK: "META",
              },
              TableName: this.#tableName,
            },
          },
        ],
      }),
    );
  }

  public async list(applicationId: string, tenantId: string): Promise<RealtimeConnection[]> {
    const items: unknown[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const response = await this.#client.send(
        new QueryCommand({
          ...(exclusiveStartKey === undefined ? {} : { ExclusiveStartKey: exclusiveStartKey }),
          ExpressionAttributeValues: {
            ":partitionKey": scopePartitionKey(applicationId, tenantId),
            ":prefix": "CONNECTION#",
          },
          KeyConditionExpression: "PK = :partitionKey AND begins_with(SK, :prefix)",
          TableName: this.#tableName,
        }),
      );
      items.push(...(response.Items ?? []));
      exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey !== undefined);

    return z.array(connectionRecordSchema).parse(items);
  }
}

const ticketPartitionKey = (ticketDigest: string): string => `REALTIME_TICKET#${ticketDigest}`;
const connectionPartitionKey = (connectionId: string): string =>
  `REALTIME_CONNECTION#${connectionId}`;
const scopePartitionKey = (applicationId: string, tenantId: string): string =>
  `REALTIME_SCOPE#${applicationId}#TENANT#${tenantId}`;
