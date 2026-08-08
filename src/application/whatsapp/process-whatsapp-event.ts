import { ulid } from "ulid";

import type { InboundImageImporter } from "../ports/media.js";
import type {
  PersistWhatsappTextMessage,
  WhatsappMessageStore,
} from "../ports/whatsapp-message-store.js";
import type {
  WhatsappInboundMessageEnvelope,
  WhatsappInboundStatusEnvelope,
} from "../../contracts/queues/whatsapp-inbound.contract.js";

export interface ProcessWhatsappEventResult {
  result: "CREATED" | "DUPLICATE" | "IGNORED" | "UPDATED";
}

export class ProcessWhatsappEvent {
  readonly #messages: WhatsappMessageStore;
  readonly #media: InboundImageImporter | undefined;

  public constructor(messages: WhatsappMessageStore, media?: InboundImageImporter) {
    this.#media = media;
    this.#messages = messages;
  }

  public async processMessage(
    envelope: WhatsappInboundMessageEnvelope,
  ): Promise<ProcessWhatsappEventResult> {
    const applicationId = required(envelope.applicationId, "applicationId");
    const integrationId = required(envelope.integrationId, "integrationId");
    const tenantId = required(envelope.tenantId, "tenantId");
    const { contact, message } = envelope.payload;

    if (
      (message.type !== "text" || message.text?.body === undefined) &&
      (message.type !== "image" || message.image === undefined) &&
      (message.type !== "location" || message.location === undefined)
    ) {
      return { result: "IGNORED" };
    }

    const bsuid = contact?.user_id ?? contact?.bsuid;
    const phone = resolvePhone(contact?.wa_id, message.from);
    const canonicalType =
      bsuid === undefined ? ("WHATSAPP_PHONE" as const) : ("WHATSAPP_BSUID" as const);
    const canonicalValue = bsuid ?? phone ?? message.from;
    const messageId = `msg_${ulid()}`;
    const common = {
      applicationId,
      ...(bsuid === undefined ? {} : { bsuid }),
      canonicalType,
      canonicalValue,
      ...(contact?.profile?.name === undefined ? {} : { displayName: contact.profile.name }),
      integrationId,
      messageId,
      occurredAt: new Date(Number(message.timestamp) * 1_000).toISOString(),
      ...(phone === undefined ? {} : { phoneE164: `+${phone}` }),
      providerMessageId: message.id,
      tenantId,
      ...(contact?.username === undefined ? {} : { username: contact.username }),
    };
    let result: "CREATED" | "DUPLICATE";
    if (message.type === "text" && message.text?.body !== undefined) {
      result = await this.#messages.persistTextMessage({ ...common, text: message.text.body });
    } else if (message.type === "location" && message.location !== undefined) {
      if (this.#messages.persistLocationMessage === undefined) return { result: "IGNORED" };
      result = await this.#messages.persistLocationMessage({
        ...common,
        latitude: message.location.latitude,
        longitude: message.location.longitude,
      });
    } else if (message.image !== undefined) {
      result = await this.#persistImage({
        common,
        image: {
          ...(message.image.caption === undefined ? {} : { caption: message.image.caption }),
          id: message.image.id,
          ...(message.image.mime_type === undefined ? {} : { mime_type: message.image.mime_type }),
          ...(message.image.sha256 === undefined ? {} : { sha256: message.image.sha256 }),
        },
      });
    } else {
      return { result: "IGNORED" };
    }

    return { result };
  }

  async #persistImage(input: {
    common: Omit<PersistWhatsappTextMessage, "text">;
    image: {
      caption?: string;
      id: string;
      mime_type?: string;
      sha256?: string;
    };
  }): Promise<"CREATED" | "DUPLICATE"> {
    if (this.#media === undefined || this.#messages.persistImageMessage === undefined) {
      throw new Error("WhatsApp image processing is not configured.");
    }
    const media = await this.#media.importWhatsappImage({
      applicationId: input.common.applicationId,
      integrationId: input.common.integrationId,
      mediaId: input.image.id,
      messageId: input.common.messageId,
      ...(input.image.mime_type === undefined ? {} : { mimeType: input.image.mime_type }),
      ...(input.image.sha256 === undefined ? {} : { providerSha256: input.image.sha256 }),
      tenantId: input.common.tenantId,
    });
    return this.#messages.persistImageMessage({
      ...input.common,
      ...(input.image.caption === undefined ? {} : { caption: input.image.caption }),
      media,
    });
  }

  public async processStatus(
    envelope: WhatsappInboundStatusEnvelope,
  ): Promise<ProcessWhatsappEventResult> {
    const integrationId = required(envelope.integrationId, "integrationId");
    const { status } = envelope.payload;
    const result = await this.#messages.persistStatus({
      ...(status.errors?.[0]?.code === undefined
        ? {}
        : { errorCode: String(status.errors[0].code) }),
      integrationId,
      occurredAt: new Date(Number(status.timestamp) * 1_000).toISOString(),
      providerMessageId: status.id,
      status: status.status.toUpperCase() as "DELIVERED" | "FAILED" | "READ" | "SENT",
      statusEventId: `${status.id}:${status.status}:${status.timestamp}`,
    });

    return { result };
  }
}

const resolvePhone = (contactWaId: string | undefined, senderId: string): string | undefined => {
  const candidate = contactWaId ?? senderId;
  const normalized = candidate.replace(/^\+/, "");

  return /^\d+$/.test(normalized) ? normalized : undefined;
};

const required = (value: string | undefined, fieldName: string): string => {
  if (value === undefined) {
    throw new Error(`WhatsApp inbound envelope is missing ${fieldName}.`);
  }

  return value;
};
