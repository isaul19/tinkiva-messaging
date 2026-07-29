import type { StoredOutgoingContent } from "./outgoing-message-store.js";

export interface AcquireWhatsappSendInput {
  applicationId: string;
  integrationId: string;
  messageId: string;
  tenantId: string;
}

export type AcquiredWhatsappSend =
  | { status: "TERMINAL" }
  | {
      conversationId: string;
      credentialRef: string;
      graphApiVersion: string;
      messageSortKey: string;
      phoneNumberId: string;
      providerMediaId?: string;
      recipientId: string;
      status: "CLAIMED";
      content: StoredOutgoingContent;
    };

export interface WhatsappSendStore {
  acquire(input: AcquireWhatsappSendInput): Promise<AcquiredWhatsappSend>;
  markFailed(input: {
    conversationId: string;
    failedAt: string;
    failureCode: string;
    messageSortKey: string;
  }): Promise<void>;
  markSent(input: {
    conversationId: string;
    integrationId: string;
    messageId: string;
    messageSortKey: string;
    providerMessageId: string;
    sentAt: string;
  }): Promise<void>;
  release(input: {
    conversationId: string;
    messageSortKey: string;
    releasedAt: string;
  }): Promise<void>;
  saveProviderMediaId(input: {
    conversationId: string;
    messageSortKey: string;
    providerMediaId: string;
  }): Promise<void>;
}
