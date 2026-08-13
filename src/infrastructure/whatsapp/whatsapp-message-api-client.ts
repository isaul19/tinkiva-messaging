import { z } from "zod";

import type {
  WhatsappMessageApi,
  WhatsappSendTextResult,
} from "../../application/ports/whatsapp-message-api.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { toWhatsappBoldMarkup } from "../../shared/text/bold-markup.js";

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

const uploadResponseSchema = z.looseObject({
  id: z.string().min(1),
});

export class WhatsappMessageApiClient implements WhatsappMessageApi {
  readonly #fetch: typeof globalThis.fetch;

  public constructor(fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  public sendImage(input: {
    accessToken: string;
    caption?: string;
    graphApiVersion: string;
    mediaId: string;
    phoneNumberId: string;
    recipientId: string;
  }): Promise<WhatsappSendTextResult> {
    return this.#send(input, {
      image: {
        ...(input.caption === undefined ? {} : { caption: toWhatsappBoldMarkup(input.caption) }),
        id: input.mediaId,
      },
      type: "image",
    });
  }

  public sendAudio(input: {
    accessToken: string;
    graphApiVersion: string;
    mediaId: string;
    phoneNumberId: string;
    recipientId: string;
  }): Promise<WhatsappSendTextResult> {
    return this.#send(input, {
      audio: { id: input.mediaId },
      type: "audio",
    });
  }

  public async uploadImage(input: {
    accessToken: string;
    bytes: Uint8Array;
    graphApiVersion: string;
    mimeType: "image/jpeg" | "image/png";
    phoneNumberId: string;
  }): Promise<{ providerMediaId: string }> {
    try {
      const form = new FormData();
      const filename = input.mimeType === "image/png" ? "image.png" : "image.jpg";
      form.append("messaging_product", "whatsapp");
      form.append(
        "file",
        new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
        filename,
      );
      const response = await this.#fetch(
        `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}/media`,
        {
          body: form,
          headers: {
            authorization: `Bearer ${input.accessToken}`,
          },
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body: unknown = await response.json();
      const parsed = uploadResponseSchema.safeParse(body);

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
            "MEDIA_INVALID",
            "Meta rejected the WhatsApp image upload.",
            422,
          );
        }
        throw providerUnavailableError();
      }

      return { providerMediaId: parsed.data.id };
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw providerUnavailableError();
    }
  }

  public uploadAudio(input: {
    accessToken: string;
    bytes: Uint8Array;
    graphApiVersion: string;
    mimeType: "audio/aac" | "audio/amr" | "audio/mpeg" | "audio/mp4" | "audio/ogg";
    phoneNumberId: string;
  }): Promise<{ providerMediaId: string }> {
    const extension: Record<typeof input.mimeType, string> = {
      "audio/aac": "aac",
      "audio/amr": "amr",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "audio/ogg": "ogg",
    };
    return this.#uploadMedia(input, `audio.${extension[input.mimeType]}`);
  }

  async #uploadMedia(
    input: {
      accessToken: string;
      bytes: Uint8Array;
      graphApiVersion: string;
      mimeType: string;
      phoneNumberId: string;
    },
    filename: string,
  ): Promise<{ providerMediaId: string }> {
    try {
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append(
        "file",
        new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
        filename,
      );
      const response = await this.#fetch(
        `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}/media`,
        {
          body: form,
          headers: { authorization: `Bearer ${input.accessToken}` },
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body: unknown = await response.json();
      const parsed = uploadResponseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        if ([401, 403].includes(response.status)) {
          throw new ApplicationError(
            "PROVIDER_CREDENTIAL_INVALID",
            "Meta rejected the WhatsApp access token.",
            400,
          );
        }
        if (response.status === 400) {
          throw new ApplicationError("MEDIA_INVALID", "Meta rejected the media upload.", 422);
        }
        throw providerUnavailableError();
      }
      return { providerMediaId: parsed.data.id };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw providerUnavailableError();
    }
  }

  public async sendText(input: {
    accessToken: string;
    graphApiVersion: string;
    phoneNumberId: string;
    recipientId: string;
    text: string;
  }): Promise<WhatsappSendTextResult> {
    return this.#send(input, {
      text: {
        body: toWhatsappBoldMarkup(input.text),
        preview_url: false,
      },
      type: "text",
    });
  }

  async #send(
    input: {
      accessToken: string;
      graphApiVersion: string;
      phoneNumberId: string;
      recipientId: string;
    },
    content: Record<string, unknown>,
  ): Promise<WhatsappSendTextResult> {
    try {
      const response = await this.#fetch(
        `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.phoneNumberId)}/messages`,
        {
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: input.recipientId,
            ...content,
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
