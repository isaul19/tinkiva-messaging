export interface TelegramDestination {
  chatId: string;
  conversationId: string;
  createDestinationRecords: boolean;
}

export interface ResolveTelegramDestinationInput {
  applicationId: string;
  conversationId?: string;
  integrationId: string;
  recipient?: {
    type: "TELEGRAM_CHAT_ID" | "WHATSAPP_BSUID" | "WHATSAPP_PHONE";
    value: string;
  };
  tenantId: string;
}

export interface ReserveTelegramMessageInput {
  applicationId: string;
  chatId: string;
  clientReferenceId?: string;
  conversationId: string;
  createDestinationRecords: boolean;
  idempotencyKey: string;
  integrationId: string;
  messageId: string;
  occurredAt: string;
  requestHash: string;
  tenantId: string;
  text: string;
}

export interface ReservedTelegramMessage {
  messageId: string;
  status: "CREATED" | "ENQUEUED";
}

export interface OutgoingMessageStore {
  markEnqueued(input: {
    applicationId: string;
    enqueuedAt: string;
    idempotencyKey: string;
    messageId: string;
    requestHash: string;
  }): Promise<void>;
  reserveTelegramMessage(input: ReserveTelegramMessageInput): Promise<ReservedTelegramMessage>;
  resolveTelegramDestination(input: ResolveTelegramDestinationInput): Promise<TelegramDestination>;
}
