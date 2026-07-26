import type { KMSClient } from "@aws-sdk/client-kms";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import type {
  CreateWhatsappCredentialInput,
  RotateWhatsappCredentialInput,
  RotateWhatsappCredentialResult,
  WhatsappCredentialVault,
} from "../../application/ports/whatsapp-credential-vault.js";
import {
  whatsappCredentialSchema,
  type WhatsappCredential,
} from "../../contracts/providers/whatsapp.contract.js";
import {
  KmsDynamoProviderCredentialVault,
  type ProviderCredentialVaultConfig,
} from "./kms-dynamo-provider-credential-vault.js";

type Config = Omit<ProviderCredentialVaultConfig<WhatsappCredential>, "provider" | "schema">;

export class KmsDynamoWhatsappCredentialVault implements WhatsappCredentialVault {
  readonly #vault: KmsDynamoProviderCredentialVault<WhatsappCredential>;

  public constructor(client: DynamoDBDocumentClient, kms: KMSClient, config: Config) {
    this.#vault = new KmsDynamoProviderCredentialVault(client, kms, {
      ...config,
      provider: "WHATSAPP",
      schema: whatsappCredentialSchema,
    });
  }

  public create(input: CreateWhatsappCredentialInput): Promise<string> {
    return this.#vault.create({
      applicationId: input.applicationId,
      credential: {
        accessToken: input.accessToken,
        appSecret: input.appSecret,
        verifyToken: input.verifyToken,
      },
      providerConnectionId: input.providerConnectionId,
      tenantId: input.tenantId,
    });
  }

  public get(credentialRef: string): Promise<WhatsappCredential> {
    return this.#vault.get(credentialRef);
  }

  public rotate(input: RotateWhatsappCredentialInput): Promise<RotateWhatsappCredentialResult> {
    return this.#vault.rotate({
      applicationId: input.applicationId,
      credential: {
        accessToken: input.accessToken,
        appSecret: input.appSecret,
        verifyToken: input.verifyToken,
      },
      expectedCredentialVersion: input.expectedCredentialVersion,
      providerConnectionId: input.providerConnectionId,
      tenantId: input.tenantId,
    });
  }

  public deleteImmediately(credentialRef: string): Promise<void> {
    return this.#vault.deleteImmediately(credentialRef);
  }
}
