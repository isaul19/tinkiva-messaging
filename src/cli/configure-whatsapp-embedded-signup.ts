import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { whatsappCredentialSchema } from "../contracts/providers/whatsapp.contract.js";
import { KmsDynamoWhatsappEmbeddedSignupConfiguration } from "../infrastructure/dynamodb/kms-dynamo-whatsapp-embedded-signup-configuration.js";

const argumentsSchema = z.object({
  appId: z.string().regex(/^\d+$/),
  configurationId: z.string().regex(/^\d+$/),
  region: z.string().min(1),
  sourceProviderConnectionId: z.string().regex(/^pc_[0-9A-Za-z_-]+$/),
  stage: z.string().regex(/^[a-z][a-z0-9-]*$/),
});

const sourceRecordSchema = z.looseObject({
  appSecretCiphertext: z.never().optional(),
  credentialCiphertext: z.string().min(1),
  credentialKeyArn: z.string().min(1),
  provider: z.literal("WHATSAPP"),
  providerConnectionId: z.string().min(1),
});

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
    appId: raw["app-id"],
    configurationId: raw["configuration-id"],
    region: raw.region ?? "us-east-1",
    sourceProviderConnectionId: raw["source-provider-connection-id"],
    stage: raw.stage ?? "dev",
  });
};

const main = async (): Promise<void> => {
  const input = parseArguments();
  const tableName = `messaging-control-${input.stage}`;
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: input.region }), {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  });
  const kms = new KMSClient({ region: input.region });
  const response = await documentClient.send(
    new GetCommand({
      ConsistentRead: true,
      Key: {
        PK: `PROVIDER_CONNECTION#${input.sourceProviderConnectionId}`,
        SK: "CREDENTIAL",
      },
      TableName: tableName,
    }),
  );
  const source = sourceRecordSchema.parse(response.Item);

  if (source.providerConnectionId !== input.sourceProviderConnectionId) {
    throw new Error("The source credential does not match the requested provider connection.");
  }

  const decrypted = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(source.credentialCiphertext, "base64"),
      EncryptionContext: {
        provider: "WHATSAPP",
        providerConnectionId: input.sourceProviderConnectionId,
        stage: input.stage,
        tableName,
      },
      KeyId: source.credentialKeyArn,
    }),
  );

  if (decrypted.Plaintext === undefined) {
    throw new Error("KMS returned no source credential plaintext.");
  }

  const credential = whatsappCredentialSchema.parse(
    JSON.parse(Buffer.from(decrypted.Plaintext).toString("utf8")) as unknown,
  );
  const configuration = new KmsDynamoWhatsappEmbeddedSignupConfiguration(documentClient, kms, {
    keyArn: source.credentialKeyArn,
    stage: input.stage,
    tableName,
  });
  const configured = await configuration.configure({
    appId: input.appId,
    appSecret: credential.appSecret,
    configurationId: input.configurationId,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        appId: input.appId,
        configurationId: input.configurationId,
        configurationVersion: configured.configurationVersion,
        sourceProviderConnectionId: input.sourceProviderConnectionId,
        status: "configured",
        updatedAt: configured.updatedAt,
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
