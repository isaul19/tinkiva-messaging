import { randomBytes } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { z } from "zod";

import { applicationScopeSchema, type ApplicationScope } from "../contracts/api/auth.contract.js";
import { CachedSecretReader } from "../infrastructure/secrets/cached-secret-reader.js";
import { digestClientSecret } from "../shared/crypto/client-secret.js";

const argumentsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  credentialsSecretName: z.string().min(1),
  name: z.string().trim().min(2).max(200),
  region: z.string().min(1),
  scopes: z.array(applicationScopeSchema).min(1),
  stage: z.string().regex(/^[a-z][a-z0-9-]*$/),
});

const pepperSchema = z.looseObject({
  value: z.string().min(32),
});

const defaultScopes: ApplicationScope[] = [
  "events:manage",
  "integrations:read",
  "integrations:write",
  "messages:read",
  "messages:send",
  "tenants:read",
  "tenants:write",
];

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
  const stage = raw.stage ?? "dev";
  const code = raw.code?.trim().toUpperCase();

  return argumentsSchema.parse({
    code,
    credentialsSecretName:
      raw["credentials-secret-name"] ??
      `/tinkiva/messaging/${stage}/applications/${code?.toLowerCase() ?? "unknown"}/client`,
    name: raw.name,
    region: raw.region ?? "us-east-1",
    scopes:
      raw.scopes === undefined ? defaultScopes : raw.scopes.split(",").map((scope) => scope.trim()),
    stage,
  });
};

const main = async (): Promise<void> => {
  const input = parseArguments();
  const tableName = `messaging-control-${input.stage}`;
  const pepperSecretId = `/tinkiva/messaging/${input.stage}/auth/pepper`;
  const nativeDynamoClient = new DynamoDBClient({ region: input.region });
  const documentClient = DynamoDBDocumentClient.from(nativeDynamoClient, {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
  const secretsClient = new SecretsManagerClient({ region: input.region });
  const secretReader = new CachedSecretReader(secretsClient);

  const existingApplication = await documentClient.send(
    new QueryCommand({
      ExpressionAttributeValues: {
        ":code": `APP_CODE#${input.code}`,
      },
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :code",
      Limit: 1,
      TableName: tableName,
    }),
  );

  if ((existingApplication.Count ?? 0) > 0) {
    throw new Error(`Application code ${input.code} already exists.`);
  }

  const applicationId = `app_${ulid()}`;
  const clientId = `msgc_${ulid()}`;
  const clientSecret = `msgs_${randomBytes(48).toString("base64url")}`;
  const pepper = await secretReader.getJson(pepperSecretId, pepperSchema);
  const secretDigest = digestClientSecret(pepper.value, clientSecret);
  const createdAt = new Date().toISOString();

  const credentialsSecret = await secretsClient.send(
    new CreateSecretCommand({
      Description: `Application client credentials for ${input.code} in ${input.stage}.`,
      Name: input.credentialsSecretName,
      SecretString: JSON.stringify({
        applicationId,
        clientId,
        clientSecret,
      }),
      Tags: [
        { Key: "DataClassification", Value: "secret" },
        { Key: "ManagedBy", Value: "tinkiva-messaging-admin-cli" },
        { Key: "Project", Value: "tinkiva-messaging" },
        { Key: "Stage", Value: input.stage },
      ],
    }),
  );

  try {
    await documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              Item: {
                PK: `APP#${applicationId}`,
                SK: "META",
                GSI1PK: `APP_CODE#${input.code}`,
                GSI1SK: `APP#${applicationId}`,
                applicationId,
                code: input.code,
                createdAt,
                entityType: "APPLICATION",
                name: input.name,
                status: "ACTIVE",
              },
              TableName: tableName,
            },
          },
          {
            Put: {
              ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              Item: {
                PK: `CLIENT#${clientId}`,
                SK: "META",
                GSI1PK: `APP#${applicationId}`,
                GSI1SK: `CLIENT#${clientId}`,
                applicationId,
                clientId,
                createdAt,
                entityType: "APPLICATION_CLIENT",
                scopes: input.scopes,
                secretDigest,
                status: "ACTIVE",
              },
              TableName: tableName,
            },
          },
        ],
      }),
    );
  } catch (error) {
    throw new Error(
      `The credential secret was created at ${input.credentialsSecretName}, but the DynamoDB transaction failed. Resolve the cause before retrying.`,
      { cause: error },
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        applicationId,
        clientId,
        credentialsSecretArn: credentialsSecret.ARN,
        credentialsSecretName: input.credentialsSecretName,
        scopes: input.scopes,
        status: "created",
      },
      null,
      2,
    )}\n`,
  );
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
