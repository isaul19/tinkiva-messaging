import { z } from "zod";

import type {
  TelegramBotApi,
  TelegramBotIdentity,
} from "../../application/ports/telegram-bot-api.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const getMeResponseSchema = z.looseObject({
  ok: z.literal(true),
  result: z.looseObject({
    first_name: z.string().min(1),
    id: z.number().int(),
    is_bot: z.literal(true),
    username: z.string().optional(),
  }),
});

const telegramSuccessSchema = z.looseObject({
  ok: z.literal(true),
});

export class TelegramBotApiClient implements TelegramBotApi {
  readonly #fetch: typeof globalThis.fetch;

  public constructor(fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  public async getMe(botToken: string): Promise<TelegramBotIdentity> {
    try {
      const response = await this.#fetch(
        `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`,
        {
          method: "POST",
          signal: AbortSignal.timeout(8_000),
        },
      );
      const body: unknown = await response.json();
      const parsed = getMeResponseSchema.safeParse(body);

      if (!response.ok || !parsed.success) {
        throw invalidCredentialError();
      }

      return {
        firstName: parsed.data.result.first_name,
        id: String(parsed.data.result.id),
        ...(parsed.data.result.username === undefined
          ? {}
          : { username: parsed.data.result.username }),
      };
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw providerUnavailableError();
    }
  }

  public async setWebhook(input: {
    botToken: string;
    dropPendingUpdates: boolean;
    secretToken: string;
    url: string;
  }): Promise<void> {
    try {
      const response = await this.#fetch(
        `https://api.telegram.org/bot${encodeURIComponent(input.botToken)}/setWebhook`,
        {
          body: JSON.stringify({
            allowed_updates: ["message", "edited_message", "callback_query"],
            drop_pending_updates: input.dropPendingUpdates,
            secret_token: input.secretToken,
            url: input.url,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(8_000),
        },
      );
      const body: unknown = await response.json();

      if (!response.ok || !telegramSuccessSchema.safeParse(body).success) {
        throw providerUnavailableError();
      }
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw providerUnavailableError();
    }
  }
}

const invalidCredentialError = (): ApplicationError =>
  new ApplicationError(
    "PROVIDER_CREDENTIAL_INVALID",
    "The Telegram bot credential is invalid.",
    400,
  );

const providerUnavailableError = (): ApplicationError =>
  new ApplicationError("PROVIDER_UNAVAILABLE", "Telegram is temporarily unavailable.", 503, true);
