import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import {
  APPLICATION_SCOPES,
  type ApplicationClientRecord,
  type ApplicationReader,
  type ApplicationRecord,
} from "../../application/ports/application-reader.js";

const applicationSchema = z.looseObject({
  applicationId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["ACTIVE", "DISABLED"]),
});

const clientSchema = z.looseObject({
  applicationId: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.array(z.enum(APPLICATION_SCOPES)),
  secretDigest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["ACTIVE", "REVOKED"]),
});

export class DynamoApplicationReader implements ApplicationReader {
  readonly #client: DynamoDBDocumentClient;
  readonly #tableName: string;

  public constructor(client: DynamoDBDocumentClient, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  public async getApplication(applicationId: string): Promise<ApplicationRecord | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        Key: {
          PK: `APP#${applicationId}`,
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : applicationSchema.parse(response.Item);
  }

  public async getClient(clientId: string): Promise<ApplicationClientRecord | undefined> {
    const response = await this.#client.send(
      new GetCommand({
        Key: {
          PK: `CLIENT#${clientId}`,
          SK: "META",
        },
        TableName: this.#tableName,
      }),
    );

    return response.Item === undefined ? undefined : clientSchema.parse(response.Item);
  }
}
