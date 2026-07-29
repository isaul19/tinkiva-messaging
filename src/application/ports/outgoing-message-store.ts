import type { MediaReference } from "./media.js";

export type StoredOutgoingContent =
  | { text: string; type: "TEXT" }
  | {
      caption?: string;
      media: MediaReference;
      type: "IMAGE";
    };

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
  content: StoredOutgoingContent;
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
