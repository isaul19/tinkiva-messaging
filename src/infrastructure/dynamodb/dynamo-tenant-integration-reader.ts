import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type { TenantIntegrationReader } from "../../application/ports/tenant-integration-reader.js";
import { inboundMediaSettingsSchema } from "../../contracts/api/inbound-media.contract.js";
import type { TenantIntegrationListItem } from "../../contracts/api/integration-list.contract.js";

const tenantIntegrationReferenceSchema = z.looseObject({
  integrationId: z.string().min(1),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
});

const integrationStatusSchema = z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]);
const integrationMetadataSchema = z.discriminatedUnion("provider", [
  z.looseObject({
    applicationId: z.string().min(1),
    botId: z.string().min(1),
    botUsername: z.string().min(1).optional(),
    createdAt: z.iso.datetime(),
    displayName: z.string().min(1),
    inboundMedia: inboundMediaSettingsSchema,
    integrationId: z.string().min(1),
    provider: z.literal("TELEGRAM"),
    providerAccountId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    status: integrationStatusSchema,
    tenantId: z.string().min(1),
    updatedAt: z.iso.datetime().optional(),
  }),
  z.looseObject({
    applicationId: z.string().min(1),
    createdAt: z.iso.datetime(),
    displayName: z.string().min(1),
    displayPhoneNumber: z.string().min(1).optional(),
    inboundMedia: inboundMediaSettingsSchema,
    integrationId: z.string().min(1),
    phoneNumberId: z.string().min(1),
    provider: z.literal("WHATSAPP"),
    providerAccountId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    status: integrationStatusSchema,
    tenantId: z.string().min(1),
    updatedAt: z.iso.datetime().optional(),
    verifiedName: z.string().min(1).optional(),
  }),
]);

const credentialMetadataSchema = z.looseObject({
  applicationId: z.string().min(1),
  credentialVersion: z.number().int().positive(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  providerConnectionId: z.string().min(1),
  tenantId: z.string().min(1),
});

export class DynamoTenantIntegrationReader implements TenantIntegrationReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async list(input: {
    applicationId: string;
    tenantId: string;
  }): Promise<TenantIntegrationListItem[]> {
    const referencesResponse = await this.#client.send(
      new QueryCommand({
        ConsistentRead: true,
        ExpressionAttributeNames: {
          "#provider": "provider",
        },
        ExpressionAttributeValues: {
          ":integrationPrefix": "INTEGRATION#",
          ":tenantPk": `TENANT#${input.tenantId}`,
        },
        KeyConditionExpression: "PK = :tenantPk AND begins_with(SK, :integrationPrefix)",
        ProjectionExpression: "integrationId, #provider",
        TableName: this.#tableName,
      }),
    );
    const references = z
      .array(tenantIntegrationReferenceSchema)
      .parse(referencesResponse.Items ?? []);

    const items = await Promise.all(
      references.map(async (reference): Promise<TenantIntegrationListItem> => {
        const integrationResponse = await this.#client.send(
          new GetCommand({
            ConsistentRead: true,
            ExpressionAttributeNames: {
              "#provider": "provider",
              "#status": "status",
            },
            Key: {
              PK: `INTEGRATION#${reference.integrationId}`,
              SK: "META",
            },
            ProjectionExpression:
              "applicationId, botId, botUsername, createdAt, displayName, " +
              "displayPhoneNumber, inboundMedia, integrationId, phoneNumberId, #provider, " +
              "providerAccountId, providerConnectionId, #status, tenantId, updatedAt, verifiedName",
            TableName: this.#tableName,
          }),
        );
        const integration = integrationMetadataSchema.parse(integrationResponse.Item);

        if (
          integration.applicationId !== input.applicationId ||
          integration.tenantId !== input.tenantId ||
          integration.integrationId !== reference.integrationId ||
          integration.provider !== reference.provider
        ) {
          throw new Error("Tenant integration metadata is inconsistent.");
        }

        const credentialResponse = await this.#client.send(
          new GetCommand({
            ConsistentRead: true,
            ExpressionAttributeNames: {
              "#provider": "provider",
            },
            Key: {
              PK: `PROVIDER_CONNECTION#${integration.providerConnectionId}`,
              SK: "CREDENTIAL",
            },
            ProjectionExpression:
              "applicationId, credentialVersion, #provider, providerConnectionId, tenantId",
            TableName: this.#tableName,
          }),
        );
        const credential = credentialMetadataSchema.parse(credentialResponse.Item);

        if (
          credential.applicationId !== input.applicationId ||
          credential.tenantId !== input.tenantId ||
          credential.provider !== integration.provider ||
          credential.providerConnectionId !== integration.providerConnectionId
        ) {
          throw new Error("Tenant credential metadata is inconsistent.");
        }

        const common = {
          createdAt: integration.createdAt,
          credentialVersion: credential.credentialVersion,
          displayName: integration.displayName,
          inboundMedia: integration.inboundMedia,
          integrationId: integration.integrationId,
          providerAccountId: integration.providerAccountId,
          status: integration.status,
          tenantId: integration.tenantId,
          ...(integration.updatedAt === undefined ? {} : { updatedAt: integration.updatedAt }),
        };

        return integration.provider === "TELEGRAM"
          ? {
              ...common,
              botId: integration.botId,
              ...(integration.botUsername === undefined
                ? {}
                : { botUsername: integration.botUsername }),
              provider: "TELEGRAM",
            }
          : {
              ...common,
              ...(integration.displayPhoneNumber === undefined
                ? {}
                : { displayPhoneNumber: integration.displayPhoneNumber }),
              phoneNumberId: integration.phoneNumberId,
              provider: "WHATSAPP",
              ...(integration.verifiedName === undefined
                ? {}
                : { verifiedName: integration.verifiedName }),
            };
      }),
    );

    return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}
