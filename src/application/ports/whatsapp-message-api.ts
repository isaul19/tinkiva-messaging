export interface WhatsappSendTextResult {
  providerMessageId: string;
}

export interface WhatsappMessageApi {
  sendText(input: {
    accessToken: string;
    graphApiVersion: string;
    phoneNumberId: string;
    recipientId: string;
    text: string;
  }): Promise<WhatsappSendTextResult>;
}
