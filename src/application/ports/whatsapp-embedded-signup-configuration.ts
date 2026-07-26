export interface WhatsappEmbeddedSignupPublicConfiguration {
  appId: string;
  configurationId: string;
  configurationVersion: number;
  status: "ACTIVE" | "DISABLED";
}

export interface WhatsappEmbeddedSignupConfiguration extends WhatsappEmbeddedSignupPublicConfiguration {
  appSecret: string;
}

export interface WhatsappEmbeddedSignupConfigurationReader {
  get(): Promise<WhatsappEmbeddedSignupConfiguration | undefined>;
  getPublic(): Promise<WhatsappEmbeddedSignupPublicConfiguration | undefined>;
}

export interface WhatsappEmbeddedSignupConfigurationWriter {
  configure(input: { appId: string; appSecret: string; configurationId: string }): Promise<{
    configurationVersion: number;
    updatedAt: string;
  }>;
}
