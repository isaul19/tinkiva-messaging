export interface WhatsappIntegrationForAdministration {
  applicationId: string;
  graphApiVersion: string;
  integrationId: string;
  metaAppId: string;
  phoneNumberId: string;
  providerConnectionId: string;
  status: "ACTIVE" | "DISABLED" | "ERROR" | "PENDING";
  tenantId: string;
  wabaId: string;
}

export interface WhatsappIntegrationAdminReader {
  get(input: {
    applicationId: string;
    integrationId: string;
    tenantId: string;
  }): Promise<WhatsappIntegrationForAdministration | undefined>;
}
