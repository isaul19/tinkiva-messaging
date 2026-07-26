import { z } from "zod";

import type {
  WhatsappMessageApi,
  WhatsappSendTextResult,
} from "../../application/ports/whatsapp-message-api.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const sendResponseSchema = z.looseObject({
  messages: z
    .array(
      z.looseObject({
        id: z.string().min(1),
      }),
    )
    .min(1),
  messaging_product: z.literal("whatsapp"),
});

export class WhatsappMessageApiClient implements WhatsappMessageApi {
  readonly #fetch: typeof globalThis.fetch;

  public constructor(fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  public async sendText(input: {
    accessToken: string;
    graphApiVersion: string;
    phoneNumberId: string;
    recipientId: string;
    text: string;
  }): Promise<WhatsappSendTextResult> {
    try {
      const response = await this.#fetch(
        `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}/messages`,
        {
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            text: {
              body: input.text,
              preview_url: false,
            },
            to: input.recipientId,
            type: "text",
          }),
          headers: {
            authorization: `Bearer ${input.accessToken}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body: unknown = await response.json();
      const parsed = sendResponseSchema.safeParse(body);

      if (!response.ok || !parsed.success) {
        if ([401, 403].includes(response.status)) {
          throw new ApplicationError(
            "PROVIDER_CREDENTIAL_INVALID",
            "Meta rejected the WhatsApp access token.",
            400,
          );
        }

        if (response.status === 400) {
          throw new ApplicationError(
            "PROVIDER_REJECTED_MESSAGE",
            "Meta rejected the WhatsApp message.",
            422,
          );
        }

        throw providerUnavailableError();
      }

      const providerMessageId = parsed.data.messages[0]?.id;

      if (providerMessageId === undefined) {
        throw providerUnavailableError();
      }

      return { providerMessageId };
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw providerUnavailableError();
    }
  }
}

const providerUnavailableError = (): ApplicationError =>
  new ApplicationError(
    "PROVIDER_UNAVAILABLE",
    "Meta Graph API is temporarily unavailable.",
    503,
    true,
  );
