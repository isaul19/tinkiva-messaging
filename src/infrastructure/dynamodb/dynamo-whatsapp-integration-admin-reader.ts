import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  WhatsappIntegrationAdminReader,
  WhatsappIntegrationForAdministration,
} from "../../application/ports/whatsapp-integration-admin-reader.js";

const statusSchema = z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]);
const integrationSchema = z.looseObject({
  applicationId: z.string().min(1),
  graphApiVersion: z.string().min(1),
  integrationId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  provider: z.literal("WHATSAPP"),
  providerConnectionId: z.string().min(1),
  status: statusSchema,
  tenantId: z.string().min(1),
  wabaId: z.string().min(1),
});
const connectionSchema = z.looseObject({
  applicationId: z.string().min(1),
  metaAppId: z.string().min(1),
  provider: z.literal("WHATSAPP"),
  providerConnectionId: z.string().min(1),
  tenantId: z.string().min(1),
  wabaId: z.string().min(1),
});

export class DynamoWhatsappIntegrationAdminReader implements WhatsappIntegrationAdminReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async get(input: {
    applicationId: string;
    integrationId: string;
    tenantId: string;
  }): Promise<WhatsappIntegrationForAdministration | undefined> {
    const integrationResponse = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
        TableName: this.#tableName,
      }),
    );
    const integration = integrationSchema.safeParse(integrationResponse.Item);

    if (
      !integration.success ||
      integration.data.applicationId !== input.applicationId ||
      integration.data.tenantId !== input.tenantId
    ) {
      return undefined;
    }

    const connectionResponse = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `PROVIDER_CONNECTION#${integration.data.providerConnectionId}`,
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );
    const connection = connectionSchema.safeParse(connectionResponse.Item);

    if (
      !connection.success ||
      connection.data.applicationId !== input.applicationId ||
      connection.data.tenantId !== input.tenantId ||
      connection.data.providerConnectionId !== integration.data.providerConnectionId ||
      connection.data.wabaId !== integration.data.wabaId
    ) {
      return undefined;
    }

    return { ...integration.data, metaAppId: connection.data.metaAppId };
  }
}
