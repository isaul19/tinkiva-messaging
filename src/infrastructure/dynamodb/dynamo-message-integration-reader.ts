import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type { MessageIntegrationReader } from "../../application/ports/message-integration-reader.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const integrationSchema = z.looseObject({
  applicationId: z.string().min(1),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  tenantId: z.string().min(1),
});

export class DynamoMessageIntegrationReader implements MessageIntegrationReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async getProvider(input: {
    applicationId: string;
    integrationId: string;
    tenantId: string;
  }): Promise<"TELEGRAM" | "WHATSAPP"> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `INTEGRATION#${input.integrationId}`,
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );
    const parsed = integrationSchema.safeParse(response.Item);

    if (
      !parsed.success ||
      parsed.data.applicationId !== input.applicationId ||
      parsed.data.tenantId !== input.tenantId
    ) {
      throw new ApplicationError(
        "INTEGRATION_NOT_FOUND",
        "The messaging integration was not found.",
        404,
      );
    }

    return parsed.data.provider;
  }
}
