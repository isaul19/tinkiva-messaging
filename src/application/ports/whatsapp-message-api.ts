export interface WhatsappSendTextResult {
  providerMessageId: string;
}

export interface WhatsappMessageApi {
  sendImage?(input: {
    accessToken: string;
    caption?: string;
    graphApiVersion: string;
    mediaId: string;
    phoneNumberId: string;
    recipientId: string;
  }): Promise<WhatsappSendTextResult>;
  sendText(input: {
    accessToken: string;
    graphApiVersion: string;
    phoneNumberId: string;
    recipientId: string;
    text: string;
  }): Promise<WhatsappSendTextResult>;
  uploadImage?(input: {
    accessToken: string;
    bytes: Uint8Array;
    graphApiVersion: string;
    mimeType: "image/jpeg" | "image/png";
    phoneNumberId: string;
  }): Promise<{ providerMediaId: string }>;
}
