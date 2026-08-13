export interface WhatsappSendTextResult {
  providerMessageId: string;
}

export interface WhatsappMessageApi {
  sendAudio?(input: {
    accessToken: string;
    graphApiVersion: string;
    mediaId: string;
    phoneNumberId: string;
    recipientId: string;
  }): Promise<WhatsappSendTextResult>;
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
  uploadAudio?(input: {
    accessToken: string;
    bytes: Uint8Array;
    graphApiVersion: string;
    mimeType: "audio/aac" | "audio/amr" | "audio/mpeg" | "audio/mp4" | "audio/ogg";
    phoneNumberId: string;
  }): Promise<{ providerMediaId: string }>;
  uploadImage?(input: {
    accessToken: string;
    bytes: Uint8Array;
    graphApiVersion: string;
    mimeType: "image/jpeg" | "image/png";
    phoneNumberId: string;
  }): Promise<{ providerMediaId: string }>;
}
