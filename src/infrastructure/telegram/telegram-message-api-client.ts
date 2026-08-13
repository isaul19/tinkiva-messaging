import { z } from "zod";

import type {
  SendTelegramTextInput,
  TelegramMessageApi,
} from "../../application/ports/telegram-message-api.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { parseBoldMarkup } from "../../shared/text/bold-markup.js";

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

  public async sendImage(input: {
    botToken: string;
    caption?: string;
    chatId: string;
    imageUrl: string;
  }): Promise<{ providerMessageId: string }> {
    const caption = input.caption === undefined ? undefined : parseBoldMarkup(input.caption);
    return this.#send(
      input.botToken,
      "sendPhoto",
      {
        ...(caption === undefined
          ? {}
          : {
              caption: caption.text,
              ...(caption.entities.length === 0 ? {} : { caption_entities: caption.entities }),
            }),
        chat_id: input.chatId,
        photo: input.imageUrl,
      },
      "image",
    );
  }

  public async sendAudio(input: {
    audioUrl: string;
    botToken: string;
    caption?: string;
    chatId: string;
  }): Promise<{ providerMessageId: string }> {
    const caption = input.caption === undefined ? undefined : parseBoldMarkup(input.caption);
    return this.#send(
      input.botToken,
      "sendAudio",
      {
        audio: input.audioUrl,
        ...(caption === undefined
          ? {}
          : {
              caption: caption.text,
              ...(caption.entities.length === 0 ? {} : { caption_entities: caption.entities }),
            }),
        chat_id: input.chatId,
      },
      "audio",
    );
  }

  public async sendText(input: SendTelegramTextInput): Promise<{ providerMessageId: string }> {
    const text = parseBoldMarkup(input.text);
    return this.#send(
      input.botToken,
      "sendMessage",
      {
        chat_id: input.chatId,
        ...(text.entities.length === 0 ? {} : { entities: text.entities }),
        text: text.text,
      },
      "message",
    );
  }

  async #send(
    botToken: string,
    method: "sendAudio" | "sendMessage" | "sendPhoto",
    payload: Record<string, unknown>,
    subject: string,
  ): Promise<{ providerMessageId: string }> {
    try {
      const response = await this.#fetch(
        `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`,
        {
          body: JSON.stringify(payload),
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
          `Telegram rejected the ${subject} or recipient.`,
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
