export interface TelegramSecretWriter {
  create(input: {
    applicationId: string;
    botToken: string;
    providerConnectionId: string;
    secretName: string;
    stage: string;
    tenantId: string;
    webhookSecretToken: string;
  }): Promise<string>;
  deleteImmediately(secretId: string): Promise<void>;
}
