export interface SendTelegramTextInput {
  botToken: string;
  chatId: string;
  text: string;
}

export interface TelegramMessageApi {
  sendText(input: SendTelegramTextInput): Promise<{ providerMessageId: string }>;
}
