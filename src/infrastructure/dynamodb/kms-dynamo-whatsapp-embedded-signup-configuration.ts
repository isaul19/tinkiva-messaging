import { DecryptCommand, EncryptCommand, type KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  WhatsappEmbeddedSignupConfiguration,
  WhatsappEmbeddedSignupConfigurationReader,
  WhatsappEmbeddedSignupConfigurationWriter,
  WhatsappEmbeddedSignupPublicConfiguration,
} from "../../application/ports/whatsapp-embedded-signup-configuration.js";

const configurationRecordSchema = z.looseObject({
  appId: z.string().regex(/^\d+$/),
  appSecretCiphertext: z.string().min(1),
  appSecretKeyArn: z.string().min(1),
  configurationId: z.string().regex(/^\d+$/),
  configurationVersion: z.number().int().positive(),
  status: z.enum(["ACTIVE", "DISABLED"]),
});

const appSecretSchema = z.strictObject({
  appSecret: z.string().min(16).max(500),
});

export interface KmsDynamoWhatsappEmbeddedSignupConfigurationConfig {
  keyArn: string;
  stage: string;
  tableName: string;
}

export class KmsDynamoWhatsappEmbeddedSignupConfiguration
  implements WhatsappEmbeddedSignupConfigurationReader, WhatsappEmbeddedSignupConfigurationWriter
{
  readonly #client: DynamoDBDocumentClient;
  readonly #keyArn: string;
  readonly #kms: KMSClient;
  readonly #stage: string;
  readonly #tableName: string;

  public constructor(
    client: DynamoDBDocumentClient,
    kms: KMSClient,
    config: KmsDynamoWhatsappEmbeddedSignupConfigurationConfig,
  ) {
    this.#client = client;
    this.#keyArn = config.keyArn;
    this.#kms = kms;
    this.#stage = config.stage;
    this.#tableName = config.tableName;
  }

  public async getPublic(): Promise<WhatsappEmbeddedSignupPublicConfiguration | undefined> {
    const record = await this.#getRecord();

    if (record === undefined) {
      return undefined;
    }

    return {
      appId: record.appId,
      configurationId: record.configurationId,
      configurationVersion: record.configurationVersion,
      status: record.status,
    };
  }

  public async get(): Promise<WhatsappEmbeddedSignupConfiguration | undefined> {
    const record = await this.#getRecord();

    if (record === undefined) {
      return undefined;
    }

    if (record.appSecretKeyArn !== this.#keyArn) {
      throw new Error("Embedded Signup configuration does not use the configured KMS key.");
    }

    const decrypted = await this.#kms.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(record.appSecretCiphertext, "base64"),
        EncryptionContext: this.#encryptionContext(),
        KeyId: this.#keyArn,
      }),
    );

    if (decrypted.Plaintext === undefined) {
      throw new Error("KMS returned no Embedded Signup App Secret plaintext.");
    }

    const secret = appSecretSchema.parse(
      JSON.parse(Buffer.from(decrypted.Plaintext).toString("utf8")) as unknown,
    );

    return {
      appId: record.appId,
      appSecret: secret.appSecret,
      configurationId: record.configurationId,
      configurationVersion: record.configurationVersion,
      status: record.status,
    };
  }

  public async configure(input: {
    appId: string;
    appSecret: string;
    configurationId: string;
  }): Promise<{ configurationVersion: number; updatedAt: string }> {
    const current = await this.#getRecord();
    const configurationVersion = (current?.configurationVersion ?? 0) + 1;
    const encrypted = await this.#kms.send(
      new EncryptCommand({
        EncryptionContext: this.#encryptionContext(),
        KeyId: this.#keyArn,
        Plaintext: Buffer.from(JSON.stringify({ appSecret: input.appSecret }), "utf8"),
      }),
    );

    if (encrypted.CiphertextBlob === undefined || encrypted.KeyId === undefined) {
      throw new Error("KMS returned no Embedded Signup App Secret ciphertext.");
    }

    const updatedAt = new Date().toISOString();
    await this.#client.send(
      new UpdateCommand({
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":active": "ACTIVE",
          ":appId": input.appId,
          ":appSecretCiphertext": Buffer.from(encrypted.CiphertextBlob).toString("base64"),
          ":appSecretKeyArn": encrypted.KeyId,
          ":configurationId": input.configurationId,
          ":configurationVersion": configurationVersion,
          ":createdAt": updatedAt,
          ":entityType": "WHATSAPP_EMBEDDED_SIGNUP_CONFIGURATION",
          ":updatedAt": updatedAt,
        },
        Key: {
          PK: "PLATFORM#WHATSAPP",
          SK: "EMBEDDED_SIGNUP",
        },
        TableName: this.#tableName,
        UpdateExpression:
          "SET appId = :appId, appSecretCiphertext = :appSecretCiphertext, " +
          "appSecretKeyArn = :appSecretKeyArn, configurationId = :configurationId, " +
          "configurationVersion = :configurationVersion, createdAt = if_not_exists(createdAt, :createdAt), " +
          "entityType = :entityType, #status = :active, updatedAt = :updatedAt",
      }),
    );

    return {
      configurationVersion,
      updatedAt,
    };
  }

  async #getRecord(): Promise<z.infer<typeof configurationRecordSchema> | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: "PLATFORM#WHATSAPP",
          SK: "EMBEDDED_SIGNUP",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : configurationRecordSchema.parse(response.Item);
  }

  #encryptionContext(): Record<string, string> {
    return {
      purpose: "WHATSAPP_EMBEDDED_SIGNUP_APP_SECRET",
      stage: this.#stage,
      tableName: this.#tableName,
    };
  }
}
