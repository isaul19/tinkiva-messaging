import { createHash } from "node:crypto";

import type { InboundImageImporter } from "../ports/media.js";
import type { ResolveInboundMediaEnrichment } from "../media/resolve-inbound-media-enrichment.js";
import type {
  PersistTelegramAudioMessage,
  PersistTelegramImageMessage,
  PersistTelegramLocationMessage,
  PersistTelegramTextMessage,
  TelegramMessageStore,
} from "../ports/telegram-message-store.js";
import type { TelegramInboundEnvelope } from "../../contracts/queues/telegram-inbound.contract.js";
import type { TelegramMessage } from "../../contracts/providers/telegram.contract.js";

export interface ProcessTelegramUpdateResult {
  result: "CREATED" | "DUPLICATE" | "IGNORED";
}

export class ProcessTelegramUpdate {
  readonly #messages: TelegramMessageStore;
  readonly #media: InboundImageImporter | undefined;
  readonly #enrichment: Pick<ResolveInboundMediaEnrichment, "requested"> | undefined;

  public constructor(
    messages: TelegramMessageStore,
    media?: InboundImageImporter,
    enrichment?: Pick<ResolveInboundMediaEnrichment, "requested">,
  ) {
    this.#enrichment = enrichment;
    this.#media = media;
    this.#messages = messages;
  }

  public async execute(envelope: TelegramInboundEnvelope): Promise<ProcessTelegramUpdateResult> {
    const integrationId = required(envelope.integrationId, "integrationId");
    const tenantId = required(envelope.tenantId, "tenantId");
    const applicationId = required(envelope.applicationId, "applicationId");
    const message = resolveMessage(envelope.payload.update);

    if (
      message === undefined ||
      (message.audio === undefined &&
        message.location === undefined &&
        message.photo === undefined &&
        message.text === undefined &&
        message.voice === undefined)
    ) {
      return {
        result: "IGNORED",
      };
    }
    if (
      message.photo !== undefined &&
      (this.#media === undefined || this.#messages.persistImageMessage === undefined)
    ) {
      return { result: "IGNORED" };
    }
    if (message.location !== undefined && this.#messages.persistLocationMessage === undefined) {
      return { result: "IGNORED" };
    }
    const audio = message.voice ?? message.audio;
    if (
      audio !== undefined &&
      (this.#media?.importTelegramAudio === undefined ||
        this.#messages.persistAudioMessage === undefined)
    ) {
      return { result: "IGNORED" };
    }

    const chatId = String(message.chat.id);
    const conversationId = deterministicConversationId(integrationId, chatId);
    const messageId = deterministicMessageId(
      integrationId,
      String(envelope.payload.update.update_id),
      String(message.message_id),
    );
    const displayName =
      message.from === undefined
        ? undefined
        : [message.from.first_name, message.from.last_name]
            .filter((part): part is string => part !== undefined)
            .join(" ");
    const common = {
      applicationId,
      chatId,
      ...(message.chat.title === undefined ? {} : { chatTitle: message.chat.title }),
      chatType: message.chat.type,
      conversationId,
      ...(displayName === undefined ? {} : { displayName }),
      integrationId,
      messageId,
      occurredAt: new Date(message.date * 1_000).toISOString(),
      providerMessageId: String(message.message_id),
      ...(message.from === undefined ? {} : { senderUserId: String(message.from.id) }),
      tenantId,
      updateId: String(envelope.payload.update.update_id),
      ...(message.from?.username === undefined ? {} : { username: message.from.username }),
    };
    let result: "CREATED" | "DUPLICATE";
    if (message.location !== undefined) {
      result = await this.#persistLocation({
        common,
        latitude: message.location.latitude,
        longitude: message.location.longitude,
      });
    } else if (audio !== undefined) {
      result = await this.#persistAudio({
        audio: {
          durationSeconds: audio.duration,
          fileId: audio.file_id,
          ...(audio.mime_type === undefined ? {} : { mimeType: audio.mime_type }),
          voice: message.voice !== undefined,
        },
        ...(message.caption === undefined ? {} : { caption: message.caption }),
        common,
      });
    } else if (message.photo === undefined) {
      if (message.text === undefined) return { result: "IGNORED" };
      result = await this.#messages.persistTextMessage({ ...common, text: message.text });
    } else {
      const largestPhoto = message.photo.at(-1);
      if (largestPhoto === undefined) return { result: "IGNORED" };
      result = await this.#persistImage({
        common,
        fileId: largestPhoto.file_id,
        ...(message.caption === undefined ? {} : { caption: message.caption }),
      });
    }

    return {
      result,
    };
  }

  async #persistAudio(input: {
    audio: {
      durationSeconds: number;
      fileId: string;
      mimeType?: string;
      voice: boolean;
    };
    caption?: string;
    common: Omit<PersistTelegramTextMessage, "text">;
  }): Promise<"CREATED" | "DUPLICATE"> {
    if (
      this.#media?.importTelegramAudio === undefined ||
      this.#messages.persistAudioMessage === undefined
    ) {
      throw new Error("Telegram audio processing is not configured.");
    }
    const media = await this.#media.importTelegramAudio({
      applicationId: input.common.applicationId,
      fileId: input.audio.fileId,
      integrationId: input.common.integrationId,
      messageId: input.common.messageId,
      ...(input.audio.mimeType === undefined ? {} : { mimeType: input.audio.mimeType }),
      tenantId: input.common.tenantId,
    });
    const audio: PersistTelegramAudioMessage = {
      ...input.common,
      ...(input.caption === undefined ? {} : { caption: input.caption }),
      durationSeconds: input.audio.durationSeconds,
      media,
      voice: input.audio.voice,
    };
    return this.#persistMedia(audio, "AUDIO");
  }

  async #persistLocation(input: {
    common: Omit<PersistTelegramTextMessage, "text">;
    latitude: number;
    longitude: number;
  }): Promise<"CREATED" | "DUPLICATE"> {
    if (this.#messages.persistLocationMessage === undefined) {
      throw new Error("Telegram location processing is not configured.");
    }
    const location: PersistTelegramLocationMessage = {
      ...input.common,
      latitude: input.latitude,
      longitude: input.longitude,
    };
    return this.#messages.persistLocationMessage(location);
  }

  async #persistImage(input: {
    caption?: string;
    common: Omit<PersistTelegramTextMessage, "text">;
    fileId: string;
  }): Promise<"CREATED" | "DUPLICATE"> {
    if (this.#media === undefined || this.#messages.persistImageMessage === undefined) {
      throw new Error("Telegram image processing is not configured.");
    }
    const media = await this.#media.importTelegramImage({
      applicationId: input.common.applicationId,
      fileId: input.fileId,
      integrationId: input.common.integrationId,
      messageId: input.common.messageId,
      tenantId: input.common.tenantId,
    });
    return this.#persistMedia(
      {
        ...input.common,
        ...(input.caption === undefined ? {} : { caption: input.caption }),
        media,
      },
      "IMAGE",
    );
  }

  async #persistMedia(
    input: PersistTelegramAudioMessage | PersistTelegramImageMessage,
    type: "AUDIO" | "IMAGE",
  ): Promise<"CREATED" | "DUPLICATE"> {
    const messageSortKey = `MESSAGE#${input.occurredAt}#${input.messageId}`;
    const job = { ...input, messageSortKey, type };
    const alternativeTextRequested = (await this.#enrichment?.requested(job)) ?? false;
    let result: "CREATED" | "DUPLICATE";
    if (type === "AUDIO" && "voice" in input) {
      if (this.#messages.persistAudioMessage === undefined) {
        throw new Error("Telegram audio processing is not configured.");
      }
      result = await this.#messages.persistAudioMessage({ ...input, alternativeTextRequested });
    } else if (type === "IMAGE" && !("voice" in input)) {
      if (this.#messages.persistImageMessage === undefined) {
        throw new Error("Telegram image processing is not configured.");
      }
      result = await this.#messages.persistImageMessage({ ...input, alternativeTextRequested });
    } else {
      throw new Error("Telegram media enrichment type is inconsistent.");
    }
    return result;
  }
}

const resolveMessage = (
  update: TelegramInboundEnvelope["payload"]["update"],
): TelegramMessage | undefined =>
  update.message ?? update.edited_message ?? update.callback_query?.message;

const deterministicConversationId = (integrationId: string, chatId: string): string =>
  `conv_${createHash("sha256")
    .update(`TELEGRAM:${integrationId}:${chatId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;

const deterministicMessageId = (
  integrationId: string,
  updateId: string,
  providerMessageId: string,
): string =>
  `msg_${createHash("sha256")
    .update(`TELEGRAM:${integrationId}:${updateId}:${providerMessageId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)}`;

const required = (value: string | undefined, fieldName: string): string => {
  if (value === undefined) {
    throw new Error(`Telegram inbound envelope is missing ${fieldName}.`);
  }

  return value;
};
