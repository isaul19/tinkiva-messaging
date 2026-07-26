export interface WhatsappEmbeddedSignupToken {
  accessToken: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface WhatsappEmbeddedSignupApi {
  exchangeAuthorizationCode(input: {
    appId: string;
    appSecret: string;
    authorizationCode: string;
    graphApiVersion: string;
  }): Promise<WhatsappEmbeddedSignupToken>;
}
