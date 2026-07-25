export interface AcquireTelegramSendInput {
  applicationId: string;
  integrationId: string;
  messageId: string;
  tenantId: string;
}

export interface ClaimedTelegramSend {
  chatId: string;
  conversationId: string;
  messageSortKey: string;
  credentialRef: string;
  status: "CLAIMED";
  text: string;
}

export interface TerminalTelegramSend {
  status: "TERMINAL";
}

export type AcquiredTelegramSend = ClaimedTelegramSend | TerminalTelegramSend;

export interface TelegramSendStore {
  acquire(input: AcquireTelegramSendInput): Promise<AcquiredTelegramSend>;
  markFailed(input: {
    conversationId: string;
    failedAt: string;
    failureCode: string;
    messageSortKey: string;
  }): Promise<void>;
  markSent(input: {
    conversationId: string;
    messageSortKey: string;
    providerMessageId: string;
    sentAt: string;
  }): Promise<void>;
  release(input: {
    conversationId: string;
    messageSortKey: string;
    releasedAt: string;
  }): Promise<void>;
}
