import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { buildConversationIndexKeys } from "../infrastructure/dynamodb/conversation-index.js";

const conversationSchema = z.looseObject({
  conversationId: z.string().min(1),
  integrationId: z.string().min(1),
  lastMessageAt: z.iso.datetime(),
  PK: z.string().min(1),
  SK: z.literal("META"),
  tenantId: z.string().min(1),
});

const integrationSchema = z.looseObject({
  applicationId: z.string().min(1),
  integrationId: z.string().min(1),
  tenantId: z.string().min(1),
});

interface CliOptions {
  apply: boolean;
  region: string;
  tableName: string;
}

const parseOptions = (args: string[]): CliOptions => {
  const valueAfter = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const tableName = valueAfter("--table") ?? process.env.CONTROL_TABLE;
  const region = valueAfter("--region") ?? process.env.AWS_REGION ?? "us-east-1";

  if (tableName === undefined || tableName.trim().length === 0) {
    throw new Error("Provide --table <control-table-name> or set CONTROL_TABLE.");
  }

  return {
    apply: args.includes("--apply"),
    region,
    tableName,
  };
};

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: options.region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let discovered = 0;
  let updated = 0;
  let skipped = 0;

  do {
    const response = await client.send(
      new ScanCommand({
        ExclusiveStartKey: exclusiveStartKey,
        ExpressionAttributeNames: {
          "#entityType": "entityType",
        },
        ExpressionAttributeValues: {
          ":conversation": "CONVERSATION",
        },
        FilterExpression: "#entityType = :conversation",
        ProjectionExpression:
          "PK, SK, applicationId, conversationId, integrationId, lastMessageAt, tenantId, GSI1PK, GSI1SK",
        TableName: options.tableName,
      }),
    );
    exclusiveStartKey = response.LastEvaluatedKey;

    for (const rawItem of response.Items ?? []) {
      const parsedConversation = conversationSchema.safeParse(rawItem);
      if (!parsedConversation.success) {
        skipped += 1;
        continue;
      }

      discovered += 1;
      const conversation = parsedConversation.data;
      const integrationResponse = await client.send(
        new GetCommand({
          ConsistentRead: true,
          Key: {
            PK: `INTEGRATION#${conversation.integrationId}`,
            SK: "META",
          },
          ProjectionExpression: "applicationId, integrationId, tenantId",
          TableName: options.tableName,
        }),
      );
      const parsedIntegration = integrationSchema.safeParse(integrationResponse.Item);
      if (
        !parsedIntegration.success ||
        parsedIntegration.data.integrationId !== conversation.integrationId ||
        parsedIntegration.data.tenantId !== conversation.tenantId
      ) {
        skipped += 1;
        continue;
      }

      const applicationId = parsedIntegration.data.applicationId;
      const index = buildConversationIndexKeys({
        applicationId,
        conversationId: conversation.conversationId,
        integrationId: conversation.integrationId,
        lastMessageAt: conversation.lastMessageAt,
        tenantId: conversation.tenantId,
      });
      if (
        rawItem.applicationId === applicationId &&
        rawItem.GSI1PK === index.GSI1PK &&
        rawItem.GSI1SK === index.GSI1SK
      ) {
        skipped += 1;
        continue;
      }

      if (options.apply) {
        await client.send(
          new UpdateCommand({
            ConditionExpression:
              "attribute_exists(PK) AND integrationId = :integrationId AND tenantId = :tenantId",
            ExpressionAttributeValues: {
              ":applicationId": applicationId,
              ":gsi1pk": index.GSI1PK,
              ":gsi1sk": index.GSI1SK,
              ":integrationId": conversation.integrationId,
              ":tenantId": conversation.tenantId,
            },
            Key: {
              PK: conversation.PK,
              SK: conversation.SK,
            },
            TableName: options.tableName,
            UpdateExpression:
              "SET applicationId = :applicationId, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk",
          }),
        );
      }
      updated += 1;
    }
  } while (exclusiveStartKey !== undefined);

  const mode = options.apply ? "applied" : "dry-run";
  process.stdout.write(
    `${JSON.stringify({
      discovered,
      mode,
      skipped,
      tableName: options.tableName,
      wouldUpdate: updated,
    })}\n`,
  );
};

await main();
