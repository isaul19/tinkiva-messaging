import { z } from "zod";

import type {
  SendTelegramTextInput,
  TelegramMessageApi,
} from "../../application/ports/telegram-message-api.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const sendMessageSuccessSchema = z.looseObject({
  ok: z.literal(true),
  result: z.looseObject({
    message_id: z.number().int(),
  }),
});

export class TelegramMessageApiClient implements TelegramMessageApi {
  readonly #fetch: typeof globalThis.fetch;

  public constructor(fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  public async sendText(input: SendTelegramTextInput): Promise<{ providerMessageId: string }> {
    try {
      const response = await this.#fetch(
        `https://api.telegram.org/bot${encodeURIComponent(input.botToken)}/sendMessage`,
        {
          body: JSON.stringify({
            chat_id: input.chatId,
            text: input.text,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body: unknown = await response.json();
      const parsed = sendMessageSuccessSchema.safeParse(body);

      if (response.status === 429) {
        throw new ApplicationError(
          "PROVIDER_RATE_LIMITED",
          "Telegram rate limited the message.",
          503,
          true,
        );
      }

      if (response.status >= 400 && response.status < 500) {
        throw new ApplicationError(
          "MESSAGE_NOT_SENDABLE",
          "Telegram rejected the message or recipient.",
          422,
        );
      }

      if (!response.ok || !parsed.success) {
        throw providerUnavailableError();
      }

      return {
        providerMessageId: String(parsed.data.result.message_id),
      };
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw providerUnavailableError();
    }
  }
}

const providerUnavailableError = (): ApplicationError =>
  new ApplicationError("PROVIDER_UNAVAILABLE", "Telegram is temporarily unavailable.", 503, true);
