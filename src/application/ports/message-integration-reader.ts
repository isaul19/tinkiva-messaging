export interface MessageIntegrationReader {
  getProvider(input: {
    applicationId: string;
    integrationId: string;
    tenantId: string;
  }): Promise<"TELEGRAM" | "WHATSAPP">;
}
