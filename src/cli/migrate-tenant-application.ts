import { createHash } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { applicationIdSchema, tenantIdSchema } from "../contracts/shared/identifiers.js";

const argumentsSchema = z.object({
  execute: z.boolean(),
  fromApplicationId: applicationIdSchema,
  region: z.string().min(1),
  stage: z.string().regex(/^[a-z][a-z0-9-]*$/),
  tenantId: tenantIdSchema,
  toApplicationId: applicationIdSchema,
});

const ownedRecordSchema = z.looseObject({
  GSI1PK: z.string().min(1).optional(),
  PK: z.string().min(1),
  SK: z.string().min(1),
  applicationId: applicationIdSchema,
  entityType: z.string().min(1),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]).optional(),
  tenantId: tenantIdSchema,
});

const linkRecordSchema = z.looseObject({
  PK: z.string().min(1),
  SK: z.string().min(1),
  applicationId: applicationIdSchema,
  entityType: z.enum(["APP_TENANT_LINK", "TENANT_APP_LINK"]),
  externalAccountId: z.string().min(1),
  tenantId: tenantIdSchema,
});

type OwnedRecord = z.infer<typeof ownedRecordSchema>;
type Write = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

const readNamedArguments = (values: string[]): Record<string, string> => {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];

    if (name === undefined || value === undefined || !name.startsWith("--")) {
      throw new Error("Arguments must use --name value pairs.");
    }

    parsed[name.slice(2)] = value;
  }

  return parsed;
};

const parseArguments = () => {
  const raw = readNamedArguments(process.argv.slice(2));

  return argumentsSchema.parse({
    execute: raw.execute === "true",
    fromApplicationId: raw["from-application-id"],
    region: raw.region ?? "us-east-1",
    stage: raw.stage ?? "dev",
    tenantId: raw["tenant-id"],
    toApplicationId: raw["to-application-id"],
  });
};

const main = async (): Promise<void> => {
  const input = parseArguments();
  if (input.fromApplicationId === input.toApplicationId) {
    throw new Error("Source and target applications must be different.");
  }

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: input.region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const controlTable = `messaging-control-${input.stage}`;
  const dataTable = `messaging-data-${input.stage}`;

  await requireRecord(client, controlTable, {
    PK: `APP#${input.fromApplicationId}`,
    SK: "META",
  });
  const targetApplication = await requireRecord(client, controlTable, {
    PK: `APP#${input.toApplicationId}`,
    SK: "META",
  });
  if (
    targetApplication.applicationId !== input.toApplicationId ||
    targetApplication.status !== "ACTIVE"
  ) {
    throw new Error("Target application is missing or is not ACTIVE.");
  }
  const tenant = await requireRecord(client, controlTable, {
    PK: `TENANT#${input.tenantId}`,
    SK: "META",
  });
  if (tenant.tenantId !== input.tenantId || tenant.status !== "ACTIVE") {
    throw new Error("Tenant is missing or is not ACTIVE.");
  }

  const [sourceInverseLink, targetInverseLink] = await Promise.all([
    findInverseLink(client, controlTable, input.tenantId, input.fromApplicationId),
    findInverseLink(client, controlTable, input.tenantId, input.toApplicationId),
  ]);
  const externalAccountId =
    sourceInverseLink?.externalAccountId ?? targetInverseLink?.externalAccountId;
  if (externalAccountId === undefined) {
    throw new Error("Neither the source nor target tenant ownership link exists.");
  }

  const [sourceAppLink, targetAppLink] = await Promise.all([
    getLink(client, controlTable, input.fromApplicationId, externalAccountId),
    getLink(client, controlTable, input.toApplicationId, externalAccountId),
  ]);
  const sourceLinksExist = sourceInverseLink !== undefined && sourceAppLink !== undefined;
  const targetLinksExist = targetInverseLink !== undefined && targetAppLink !== undefined;
  if (
    (sourceInverseLink === undefined) !== (sourceAppLink === undefined) ||
    (targetInverseLink === undefined) !== (targetAppLink === undefined) ||
    (sourceLinksExist && targetLinksExist)
  ) {
    throw new Error("Tenant ownership links are in a mixed or conflicting state.");
  }
  if (
    (sourceAppLink !== undefined && sourceAppLink.tenantId !== input.tenantId) ||
    (targetAppLink !== undefined && targetAppLink.tenantId !== input.tenantId)
  ) {
    throw new Error("An application ownership link points to a different tenant.");
  }

  const [controlRecords, dataRecords] = await Promise.all([
    scanOwnedRecords(client, controlTable, input.fromApplicationId, input.tenantId),
    scanOwnedRecords(client, dataTable, input.fromApplicationId, input.tenantId),
  ]);
  const realtimeRecords = controlRecords.filter(
    (record) => record.entityType === "REALTIME_CONNECTION",
  );
  const durableControlRecords = controlRecords.filter(
    (record) =>
      !["APP_TENANT_LINK", "TENANT_APP_LINK", "REALTIME_CONNECTION"].includes(record.entityType),
  );
  const conversations = durableControlRecords.filter(
    (record) => record.entityType === "CONVERSATION",
  );
  const integrations = durableControlRecords.filter(
    (record) => record.entityType === "CHANNEL_INTEGRATION",
  );
  const providers = [
    ...new Set(integrations.map((record) => record.provider).filter(Boolean)),
  ].sort();

  if (!targetLinksExist && !sourceLinksExist) {
    throw new Error("No complete tenant ownership link pair was found.");
  }
  if (sourceLinksExist && providers.join(",") !== "TELEGRAM,WHATSAPP") {
    throw new Error("Expected one Telegram and one WhatsApp integration before migration.");
  }

  const writes: Write[] = [
    {
      ConditionCheck: {
        ConditionExpression: "applicationId = :applicationId AND #status = :active",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":active": "ACTIVE",
          ":applicationId": input.toApplicationId,
        },
        Key: { PK: `APP#${input.toApplicationId}`, SK: "META" },
        TableName: controlTable,
      },
    },
  ];

  if (sourceLinksExist) {
    const sourceDirect = linkRecordSchema.parse(sourceAppLink);
    const sourceInverse = linkRecordSchema.parse(sourceInverseLink);
    writes.push(
      putNewLink(controlTable, {
        ...sourceDirect,
        PK: `APP#${input.toApplicationId}`,
        applicationId: input.toApplicationId,
      }),
      putNewLink(controlTable, {
        ...sourceInverse,
        SK: `APP#${input.toApplicationId}#ACCOUNT#${externalAccountId}`,
        applicationId: input.toApplicationId,
      }),
      deleteOldLink(controlTable, sourceDirect, input.fromApplicationId, input.tenantId),
      deleteOldLink(controlTable, sourceInverse, input.fromApplicationId, input.tenantId),
    );
  }

  for (const record of durableControlRecords) {
    writes.push(
      record.entityType === "CONVERSATION"
        ? updateConversation(controlTable, record, input)
        : updateOwnership(controlTable, record, input),
    );
  }
  for (const record of dataRecords) {
    writes.push(updateOwnership(dataTable, record, input));
  }

  if (writes.length > 100) {
    throw new Error(
      `Migration requires ${String(writes.length)} transaction items; DynamoDB permits 100.`,
    );
  }

  const summary = {
    conversations: conversations.length,
    dataRecords: dataRecords.length,
    durableControlRecords: durableControlRecords.length,
    externalAccountId,
    fromApplicationId: input.fromApplicationId,
    integrations: integrations.map((record) => ({
      integrationId: record.PK.replace(/^INTEGRATION#/, ""),
      provider: record.provider,
    })),
    mode: input.execute ? "execute" : "dry-run",
    realtimeRecordsSkipped: realtimeRecords.length,
    stage: input.stage,
    tenantId: input.tenantId,
    toApplicationId: input.toApplicationId,
    transactionItems: writes.length,
  };

  if (!input.execute) {
    process.stdout.write(`${JSON.stringify({ ...summary, status: "ready" }, null, 2)}\n`);
    return;
  }

  await client.send(new TransactWriteCommand({ TransactItems: writes }));

  const [remainingControl, remainingData, migratedControl, migratedData, migratedInverse] =
    await Promise.all([
      scanOwnedRecords(client, controlTable, input.fromApplicationId, input.tenantId),
      scanOwnedRecords(client, dataTable, input.fromApplicationId, input.tenantId),
      scanOwnedRecords(client, controlTable, input.toApplicationId, input.tenantId),
      scanOwnedRecords(client, dataTable, input.toApplicationId, input.tenantId),
      findInverseLink(client, controlTable, input.tenantId, input.toApplicationId),
    ]);
  const remainingDurableControl = remainingControl.filter(
    (record) => record.entityType !== "REALTIME_CONNECTION",
  );
  if (
    remainingDurableControl.length > 0 ||
    remainingData.length > 0 ||
    migratedInverse?.externalAccountId !== externalAccountId
  ) {
    throw new Error("Post-migration verification found inconsistent ownership records.");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ...summary,
        migratedControlRecords: migratedControl.length,
        migratedDataRecords: migratedData.length,
        status: "migrated",
      },
      null,
      2,
    )}\n`,
  );
};

const scanOwnedRecords = async (
  client: DynamoDBDocumentClient,
  tableName: string,
  applicationId: string,
  tenantId: string,
): Promise<OwnedRecord[]> => {
  const items: unknown[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const response = await client.send(
      new ScanCommand({
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
        ExpressionAttributeNames: { "#provider": "provider" },
        ExpressionAttributeValues: {
          ":applicationId": applicationId,
          ":tenantId": tenantId,
        },
        FilterExpression: "applicationId = :applicationId AND tenantId = :tenantId",
        ProjectionExpression: "PK, SK, applicationId, tenantId, entityType, GSI1PK, #provider",
        TableName: tableName,
      }),
    );
    items.push(...(response.Items ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey !== undefined);

  return z.array(ownedRecordSchema).parse(items);
};

const requireRecord = async (
  client: DynamoDBDocumentClient,
  tableName: string,
  Key: { PK: string; SK: string },
): Promise<Record<string, unknown>> => {
  const response = await client.send(
    new GetCommand({ ConsistentRead: true, Key, TableName: tableName }),
  );
  if (response.Item === undefined)
    throw new Error(`Required record ${Key.PK}/${Key.SK} is missing.`);
  return response.Item;
};

const findInverseLink = async (
  client: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  applicationId: string,
): Promise<z.infer<typeof linkRecordSchema> | undefined> => {
  const response = await client.send(
    new QueryCommand({
      ConsistentRead: true,
      ExpressionAttributeValues: {
        ":pk": `TENANT#${tenantId}`,
        ":prefix": `APP#${applicationId}#ACCOUNT#`,
      },
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      Limit: 2,
      TableName: tableName,
    }),
  );
  if ((response.Items?.length ?? 0) > 1) throw new Error("Multiple inverse tenant links found.");
  return response.Items?.[0] === undefined ? undefined : linkRecordSchema.parse(response.Items[0]);
};

const getLink = async (
  client: DynamoDBDocumentClient,
  tableName: string,
  applicationId: string,
  externalAccountId: string,
): Promise<Record<string, unknown> | undefined> => {
  const response = await client.send(
    new GetCommand({
      ConsistentRead: true,
      Key: { PK: `APP#${applicationId}`, SK: `ACCOUNT#${externalAccountId}` },
      TableName: tableName,
    }),
  );
  return response.Item;
};

const putNewLink = (tableName: string, Item: Record<string, unknown>): Write => ({
  Put: {
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    Item,
    TableName: tableName,
  },
});

const deleteOldLink = (
  tableName: string,
  record: z.infer<typeof linkRecordSchema>,
  applicationId: string,
  tenantId: string,
): Write => ({
  Delete: {
    ConditionExpression: "applicationId = :applicationId AND tenantId = :tenantId",
    ExpressionAttributeValues: { ":applicationId": applicationId, ":tenantId": tenantId },
    Key: { PK: record.PK, SK: record.SK },
    TableName: tableName,
  },
});

const updateOwnership = (
  tableName: string,
  record: OwnedRecord,
  input: z.infer<typeof argumentsSchema>,
): Write => ({
  Update: {
    ConditionExpression: "applicationId = :from AND tenantId = :tenantId",
    ExpressionAttributeValues: {
      ":from": input.fromApplicationId,
      ":tenantId": input.tenantId,
      ":to": input.toApplicationId,
    },
    Key: { PK: record.PK, SK: record.SK },
    TableName: tableName,
    UpdateExpression: "SET applicationId = :to",
  },
});

const updateConversation = (
  tableName: string,
  record: OwnedRecord,
  input: z.infer<typeof argumentsSchema>,
): Write => {
  const oldPrefix = `APPLICATION#${input.fromApplicationId}#TENANT#${input.tenantId}#`;
  if (record.GSI1PK?.startsWith(oldPrefix) !== true) {
    throw new Error(`Conversation ${record.PK} has an unexpected GSI1PK.`);
  }
  const newIndex = record.GSI1PK.replace(
    oldPrefix,
    `APPLICATION#${input.toApplicationId}#TENANT#${input.tenantId}#`,
  );

  return {
    Update: {
      ConditionExpression: "applicationId = :from AND tenantId = :tenantId AND GSI1PK = :oldIndex",
      ExpressionAttributeValues: {
        ":from": input.fromApplicationId,
        ":newIndex": newIndex,
        ":oldIndex": record.GSI1PK,
        ":tenantId": input.tenantId,
        ":to": input.toApplicationId,
      },
      Key: { PK: record.PK, SK: record.SK },
      TableName: tableName,
      UpdateExpression: "SET applicationId = :to, GSI1PK = :newIndex",
    },
  };
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  const reference = createHash("sha256").update(message, "utf8").digest("hex").slice(0, 12);
  process.stderr.write(`Tenant application migration failed (${reference}): ${message}\n`);
  process.exitCode = 1;
});
