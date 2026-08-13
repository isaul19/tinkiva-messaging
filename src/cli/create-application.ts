import { randomBytes } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CreateSecretCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { z } from "zod";

import { CachedSecretReader } from "../infrastructure/secrets/cached-secret-reader.js";
import { digestClientSecret } from "../shared/crypto/client-secret.js";
import {
  createApplicationOutput,
  parseCreateApplicationArguments,
} from "./create-application-options.js";

const pepperSchema = z.looseObject({
  value: z.string().min(32),
});

const main = async (): Promise<void> => {
  const input = parseCreateApplicationArguments(process.argv.slice(2));
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

  const credentialsSecret =
    input.credentialsSecretName === undefined
      ? undefined
      : await secretsClient.send(
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
    if (input.credentialsSecretName !== undefined) {
      throw new Error(
        `The credential secret was created at ${input.credentialsSecretName}, but the DynamoDB transaction failed. Resolve the cause before retrying.`,
        { cause: error },
      );
    }

    throw error;
  }

  process.stdout.write(
    `${JSON.stringify(
      createApplicationOutput({
        applicationId,
        clientId,
        clientSecret,
        ...(credentialsSecret?.ARN === undefined
          ? {}
          : { credentialsSecretArn: credentialsSecret.ARN }),
        ...(input.credentialsSecretName === undefined
          ? {}
          : { credentialsSecretName: input.credentialsSecretName }),
        scopes: input.scopes,
      }),
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
