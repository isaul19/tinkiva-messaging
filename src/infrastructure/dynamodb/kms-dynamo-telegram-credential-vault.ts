import type { KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type {
  CreateTelegramCredentialInput,
  TelegramCredential,
  TelegramCredentialVault,
} from "../../application/ports/telegram-credential-vault.js";
import { telegramSecretSchema } from "../../contracts/providers/telegram.contract.js";
import {
  KmsDynamoProviderCredentialVault,
  type ProviderCredentialVaultConfig,
} from "./kms-dynamo-provider-credential-vault.js";

export type KmsDynamoTelegramCredentialVaultConfig = Omit<
  ProviderCredentialVaultConfig<TelegramCredential>,
  "provider" | "schema"
>;

export class KmsDynamoTelegramCredentialVault implements TelegramCredentialVault {
  readonly #vault: KmsDynamoProviderCredentialVault<TelegramCredential>;

  public constructor(
    client: DynamoDBDocumentClient,
    kms: KMSClient,
    config: KmsDynamoTelegramCredentialVaultConfig,
  ) {
    this.#vault = new KmsDynamoProviderCredentialVault(client, kms, {
      ...config,
      provider: "TELEGRAM",
      schema: telegramSecretSchema,
    });
  }

  public create(input: CreateTelegramCredentialInput): Promise<string> {
    return this.#vault.create({
      applicationId: input.applicationId,
      credential: {
        botToken: input.botToken,
        webhookSecretToken: input.webhookSecretToken,
      },
      providerConnectionId: input.providerConnectionId,
      tenantId: input.tenantId,
    });
  }

  public get(credentialRef: string): Promise<TelegramCredential> {
    return this.#vault.get(credentialRef);
  }

  public deleteImmediately(credentialRef: string): Promise<void> {
    return this.#vault.deleteImmediately(credentialRef);
  }
}
