export interface WhatsappPhoneNumber {
  displayPhoneNumber?: string;
  id: string;
  qualityRating?: string;
  verifiedName?: string;
}

export interface WhatsappManagementApi {
  getPhoneNumbers(input: {
    accessToken: string;
    graphApiVersion: string;
    wabaId: string;
  }): Promise<WhatsappPhoneNumber[]>;
  subscribeWaba(input: {
    accessToken: string;
    callbackUrl: string;
    graphApiVersion: string;
    verifyToken: string;
    wabaId: string;
  }): Promise<void>;
}
