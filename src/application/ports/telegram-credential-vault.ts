export interface TelegramCredential {
  botToken: string;
  webhookSecretToken: string;
}

export interface CreateTelegramCredentialInput extends TelegramCredential {
  applicationId: string;
  providerConnectionId: string;
  tenantId: string;
}

export interface TelegramCredentialReader {
  get(credentialRef: string): Promise<TelegramCredential>;
}

export interface TelegramCredentialWriter {
  create(input: CreateTelegramCredentialInput): Promise<string>;
  deleteImmediately(credentialRef: string): Promise<void>;
}

export type TelegramCredentialVault = TelegramCredentialReader & TelegramCredentialWriter;
