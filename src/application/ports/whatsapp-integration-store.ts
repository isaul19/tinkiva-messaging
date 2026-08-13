import type { InboundMediaSettings } from "../../contracts/api/inbound-media.contract.js";

export interface CreateWhatsappIntegrationRecords {
  applicationId: string;
  businessPortfolioId?: string;
  createdAt: string;
  credentialRef: string;
  displayName: string;
  displayPhoneNumber?: string;
  graphApiVersion: string;
  inboundMedia: InboundMediaSettings;
  integrationId: string;
  metaAppId: string;
  phoneNumberId: string;
  providerConnectionId: string;
  tenantId: string;
  verifiedName?: string;
  wabaId: string;
  webhookKey: string;
  webhookUrl: string;
}

export interface DeletePendingWhatsappIntegrationRecords {
  integrationId: string;
  phoneNumberId: string;
  providerConnectionId: string;
  tenantId: string;
  wabaId: string;
  webhookKey: string;
}

export interface WhatsappIntegrationStore {
  createPending(input: CreateWhatsappIntegrationRecords): Promise<void>;
  deletePending(input: DeletePendingWhatsappIntegrationRecords): Promise<void>;
  setStatus(
    integrationId: string,
    phoneNumberId: string,
    providerConnectionId: string,
    tenantId: string,
    wabaId: string,
    webhookKey: string,
    status: "ACTIVE" | "ERROR",
    updatedAt: string,
  ): Promise<void>;
}
