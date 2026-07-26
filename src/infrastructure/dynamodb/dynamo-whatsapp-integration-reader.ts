import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  WhatsappIntegrationReader,
  WhatsappPhoneIntegration,
  WhatsappWebhookConnection,
} from "../../application/ports/whatsapp-integration-reader.js";

const statusSchema = z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]);

const webhookConnectionSchema = z.looseObject({
  applicationId: z.string().min(1),
  credentialRef: z.string().min(1),
  providerConnectionId: z.string().min(1),
  status: statusSchema,
  tenantId: z.string().min(1),
});

const phoneIntegrationSchema = z.looseObject({
  applicationId: z.string().min(1),
  integrationId: z.string().min(1),
  providerConnectionId: z.string().min(1),
  status: statusSchema,
  tenantId: z.string().min(1),
});

export class DynamoWhatsappIntegrationReader implements WhatsappIntegrationReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async getByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<WhatsappPhoneIntegration | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `WHATSAPP_PHONE_NUMBER#${phoneNumberId}`,
          SK: "REF",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : phoneIntegrationSchema.parse(response.Item);
  }

  public async getByWebhookKey(webhookKey: string): Promise<WhatsappWebhookConnection | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `WEBHOOK#WHATSAPP#${webhookKey}`,
          SK: "REF",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : webhookConnectionSchema.parse(response.Item);
  }
}
