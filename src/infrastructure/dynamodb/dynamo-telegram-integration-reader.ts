import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import type {
  TelegramIntegrationReader,
  TelegramWebhookIntegration,
} from "../../application/ports/telegram-integration-reader.js";

const webhookIntegrationSchema = z.looseObject({
  applicationId: z.string().min(1),
  integrationId: z.string().min(1),
  secretArn: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]),
  tenantId: z.string().min(1),
});

export class DynamoTelegramIntegrationReader implements TelegramIntegrationReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async getByWebhookKey(
    webhookKey: string,
  ): Promise<TelegramWebhookIntegration | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        ConsistentRead: true,
        Key: {
          PK: `WEBHOOK#TELEGRAM#${webhookKey}`,
          SK: "REF",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : webhookIntegrationSchema.parse(response.Item);
  }
}
