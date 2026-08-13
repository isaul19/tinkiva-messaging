import type { InboundMediaSettings } from "../../contracts/api/inbound-media.contract.js";

export interface CreateTelegramIntegrationRecords {
  applicationId: string;
  botId: string;
  botUsername?: string;
  createdAt: string;
  displayName: string;
  inboundMedia: InboundMediaSettings;
  integrationId: string;
  providerConnectionId: string;
  credentialRef: string;
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
