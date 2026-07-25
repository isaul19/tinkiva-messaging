export interface PersistTelegramTextMessage {
  applicationId: string;
  chatId: string;
  chatTitle?: string;
  chatType: "channel" | "group" | "private" | "supergroup";
  conversationId: string;
  displayName?: string;
  integrationId: string;
  messageId: string;
  occurredAt: string;
  providerMessageId: string;
  senderUserId?: string;
  tenantId: string;
  text: string;
  updateId: string;
  username?: string;
}

export interface TelegramMessageStore {
  persistTextMessage(input: PersistTelegramTextMessage): Promise<"CREATED" | "DUPLICATE">;
}
