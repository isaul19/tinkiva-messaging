import {
  CreateSecretCommand,
  DeleteSecretCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import type { TelegramSecretWriter } from "../../application/ports/telegram-secret-writer.js";

export class SecretsManagerTelegramSecretWriter implements TelegramSecretWriter {
  readonly #client: SecretsManagerClient;

  public constructor(client: SecretsManagerClient) {
    this.#client = client;
  }

  public async create(input: {
    applicationId: string;
    botToken: string;
    providerConnectionId: string;
    secretName: string;
    stage: string;
    tenantId: string;
    webhookSecretToken: string;
  }): Promise<string> {
    const response = await this.#client.send(
      new CreateSecretCommand({
        Description: `Telegram bot credentials for ${input.providerConnectionId}.`,
        Name: input.secretName,
        SecretString: JSON.stringify({
          botToken: input.botToken,
          webhookSecretToken: input.webhookSecretToken,
        }),
        Tags: [
          { Key: "ApplicationId", Value: input.applicationId },
          { Key: "DataClassification", Value: "secret" },
          { Key: "ManagedBy", Value: "tinkiva-messaging-gateway" },
          { Key: "Provider", Value: "TELEGRAM" },
          { Key: "Stage", Value: input.stage },
          { Key: "TenantId", Value: input.tenantId },
        ],
      }),
    );

    if (response.ARN === undefined) {
      throw new Error("Secrets Manager did not return an ARN.");
    }

    return response.ARN;
  }

  public async deleteImmediately(secretId: string): Promise<void> {
    await this.#client.send(
      new DeleteSecretCommand({
        ForceDeleteWithoutRecovery: true,
        SecretId: secretId,
      }),
    );
  }
}
