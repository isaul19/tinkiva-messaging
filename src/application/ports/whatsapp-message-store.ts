export interface PersistWhatsappTextMessage {
  applicationId: string;
  bsuid?: string;
  canonicalType: "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
  canonicalValue: string;
  displayName?: string;
  integrationId: string;
  messageId: string;
  occurredAt: string;
  phoneE164?: string;
  providerMessageId: string;
  tenantId: string;
  text: string;
  username?: string;
}

export interface PersistWhatsappStatus {
  errorCode?: string;
  integrationId: string;
  occurredAt: string;
  providerMessageId: string;
  status: "DELIVERED" | "FAILED" | "READ" | "SENT";
  statusEventId: string;
}

export interface WhatsappMessageStore {
  persistStatus(input: PersistWhatsappStatus): Promise<"IGNORED" | "UPDATED" | "DUPLICATE">;
  persistTextMessage(input: PersistWhatsappTextMessage): Promise<"CREATED" | "DUPLICATE">;
}
