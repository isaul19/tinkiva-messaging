export interface SendTelegramTextInput {
  botToken: string;
  chatId: string;
  text: string;
}

export interface TelegramMessageApi {
  sendAudio?(input: {
    audioUrl: string;
    botToken: string;
    caption?: string;
    chatId: string;
  }): Promise<{ providerMessageId: string }>;
  sendImage?(input: {
    botToken: string;
    caption?: string;
    chatId: string;
    imageUrl: string;
  }): Promise<{ providerMessageId: string }>;
  sendText(input: SendTelegramTextInput): Promise<{ providerMessageId: string }>;
}
