export interface SendTelegramTextInput {
  botToken: string;
  chatId: string;
  text: string;
}

export interface TelegramMessageApi {
  sendImage?(input: {
    botToken: string;
    caption?: string;
    chatId: string;
    imageUrl: string;
  }): Promise<{ providerMessageId: string }>;
  sendText(input: SendTelegramTextInput): Promise<{ providerMessageId: string }>;
}
