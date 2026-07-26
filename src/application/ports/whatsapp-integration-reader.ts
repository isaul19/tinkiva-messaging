export interface WhatsappWebhookConnection {
  applicationId: string;
  credentialRef: string;
  providerConnectionId: string;
  status: "ACTIVE" | "DISABLED" | "ERROR" | "PENDING";
  tenantId: string;
}

export interface WhatsappPhoneIntegration {
  applicationId: string;
  integrationId: string;
  providerConnectionId: string;
  status: "ACTIVE" | "DISABLED" | "ERROR" | "PENDING";
  tenantId: string;
}

export interface WhatsappIntegrationReader {
  getByPhoneNumberId(phoneNumberId: string): Promise<WhatsappPhoneIntegration | undefined>;
  getByWebhookKey(webhookKey: string): Promise<WhatsappWebhookConnection | undefined>;
}
