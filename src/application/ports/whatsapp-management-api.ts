export interface WhatsappPhoneNumber {
  displayPhoneNumber?: string;
  id: string;
  qualityRating?: string;
  verifiedName?: string;
}

export interface WhatsappAccessTokenMetadata {
  appId: string;
  dataAccessExpiresAt?: number;
  expiresAt?: number;
  isValid: boolean;
  scopes: string[];
  type?: string;
}

export interface WhatsappManagementApi {
  getPhoneNumbers(input: {
    accessToken: string;
    graphApiVersion: string;
    wabaId: string;
  }): Promise<WhatsappPhoneNumber[]>;
  inspectAccessToken(input: {
    accessToken: string;
    appId: string;
    appSecret: string;
    graphApiVersion: string;
  }): Promise<WhatsappAccessTokenMetadata>;
  subscribeWaba(input: {
    accessToken: string;
    callbackUrl: string;
    graphApiVersion: string;
    verifyToken: string;
    wabaId: string;
  }): Promise<void>;
}
