export interface TelegramBotIdentity {
  firstName: string;
  id: string;
  username?: string;
}

export interface TelegramBotApi {
  getMe(botToken: string): Promise<TelegramBotIdentity>;
  setWebhook(input: {
    botToken: string;
    dropPendingUpdates: boolean;
    secretToken: string;
    url: string;
  }): Promise<void>;
}
