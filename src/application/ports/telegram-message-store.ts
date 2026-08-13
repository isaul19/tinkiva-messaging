import type { MediaReference } from "./media.js";

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

export interface PersistTelegramImageMessage extends Omit<PersistTelegramTextMessage, "text"> {
  alternativeTextRequested?: boolean;
  caption?: string;
  media: MediaReference;
}

export interface PersistTelegramAudioMessage extends Omit<PersistTelegramTextMessage, "text"> {
  alternativeTextRequested?: boolean;
  caption?: string;
  durationSeconds?: number;
  media: MediaReference;
  voice: boolean;
}

export interface PersistTelegramLocationMessage extends Omit<PersistTelegramTextMessage, "text"> {
  latitude: number;
  longitude: number;
}

export interface TelegramMessageStore {
  persistAudioMessage?(input: PersistTelegramAudioMessage): Promise<"CREATED" | "DUPLICATE">;
  persistImageMessage?(input: PersistTelegramImageMessage): Promise<"CREATED" | "DUPLICATE">;
  persistLocationMessage?(input: PersistTelegramLocationMessage): Promise<"CREATED" | "DUPLICATE">;
  persistTextMessage(input: PersistTelegramTextMessage): Promise<"CREATED" | "DUPLICATE">;
}
