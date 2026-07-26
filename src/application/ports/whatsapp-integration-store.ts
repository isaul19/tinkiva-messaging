export interface CreateWhatsappIntegrationRecords {
  applicationId: string;
  businessPortfolioId?: string;
  createdAt: string;
  credentialRef: string;
  displayName: string;
  displayPhoneNumber?: string;
  graphApiVersion: string;
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

export interface WhatsappIntegrationStore {
  createPending(input: CreateWhatsappIntegrationRecords): Promise<void>;
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
