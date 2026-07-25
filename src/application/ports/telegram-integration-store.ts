export interface CreateTelegramIntegrationRecords {
  applicationId: string;
  botId: string;
  botUsername?: string;
  createdAt: string;
  displayName: string;
  integrationId: string;
  providerConnectionId: string;
  secretArn: string;
  tenantId: string;
  webhookKey: string;
  webhookUrl: string;
}

export interface TelegramIntegrationStore {
  createPending(input: CreateTelegramIntegrationRecords): Promise<void>;
  setStatus(
    integrationId: string,
    providerConnectionId: string,
    tenantId: string,
    webhookKey: string,
    status: "ACTIVE" | "ERROR",
    updatedAt: string,
  ): Promise<void>;
}
