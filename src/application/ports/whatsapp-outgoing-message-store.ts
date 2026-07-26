export interface WhatsappDestination {
  conversationId: string;
  createDestinationRecords: boolean;
  recipientId: string;
  recipientType: "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
}

export interface ResolveWhatsappDestinationInput {
  applicationId: string;
  conversationId?: string;
  integrationId: string;
  recipient?: {
    type: "TELEGRAM_CHAT_ID" | "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
    value: string;
  };
  tenantId: string;
}

export interface ReserveWhatsappMessageInput {
  applicationId: string;
  clientReferenceId?: string;
  conversationId: string;
  createDestinationRecords: boolean;
  idempotencyKey: string;
  integrationId: string;
  messageId: string;
  occurredAt: string;
  recipientId: string;
  recipientType: "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
  requestHash: string;
  tenantId: string;
  text: string;
}

export interface ReservedWhatsappMessage {
  messageId: string;
  status: "CREATED" | "ENQUEUED";
}

export interface WhatsappOutgoingMessageStore {
  markEnqueued(input: {
    applicationId: string;
    enqueuedAt: string;
    idempotencyKey: string;
    messageId: string;
    requestHash: string;
  }): Promise<void>;
  reserveWhatsappMessage(input: ReserveWhatsappMessageInput): Promise<ReservedWhatsappMessage>;
  resolveWhatsappDestination(input: ResolveWhatsappDestinationInput): Promise<WhatsappDestination>;
}
