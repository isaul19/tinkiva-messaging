export interface TelegramWebhookIntegration {
  applicationId: string;
  integrationId: string;
  secretArn: string;
  status: "ACTIVE" | "DISABLED" | "ERROR" | "PENDING";
  tenantId: string;
}

export interface TelegramIntegrationReader {
  getByWebhookKey(webhookKey: string): Promise<TelegramWebhookIntegration | undefined>;
}
