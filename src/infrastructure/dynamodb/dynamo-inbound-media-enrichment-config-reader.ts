import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  InboundMediaEnrichmentConfig,
  InboundMediaEnrichmentConfigReader,
  InboundMediaEnrichmentConfigReaderInput,
} from "../../application/ports/inbound-media-enrichment-config-reader.js";
import { inboundMediaSettingsSchema } from "../../contracts/api/inbound-media.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const integrationConfigRecordSchema = z.looseObject({
  applicationId: z.string().min(1),
  inboundMedia: inboundMediaSettingsSchema,
  integrationId: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]),
  tenantId: z.string().min(1),
});

export class DynamoInboundMediaEnrichmentConfigReader implements InboundMediaEnrichmentConfigReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async get(
    input: InboundMediaEnrichmentConfigReaderInput,
  ): Promise<InboundMediaEnrichmentConfig> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: { PK: `INTEGRATION#${input.integrationId}`, SK: "META" },
        TableName: this.#tableName,
      }),
    );

    const parsed = integrationConfigRecordSchema.safeParse(response.Item);

    if (
      !parsed.success ||
      parsed.data.applicationId !== input.applicationId ||
      parsed.data.integrationId !== input.integrationId ||
      parsed.data.tenantId !== input.tenantId
    ) {
      throw new ApplicationError("INTEGRATION_NOT_FOUND", "The integration was not found.", 404);
    }

    return {
      inboundMedia:
        parsed.data.status === "ACTIVE"
          ? parsed.data.inboundMedia
          : { audioAlternativeText: false, imageAlternativeText: false },
    };
  }
}
