import { ulid } from "ulid";

import type { WhatsappMessageStore } from "../ports/whatsapp-message-store.js";
import type {
  WhatsappInboundMessageEnvelope,
  WhatsappInboundStatusEnvelope,
} from "../../contracts/queues/whatsapp-inbound.contract.js";

export interface ProcessWhatsappEventResult {
  result: "CREATED" | "DUPLICATE" | "IGNORED" | "UPDATED";
}

export class ProcessWhatsappEvent {
  readonly #messages: WhatsappMessageStore;

  public constructor(messages: WhatsappMessageStore) {
    this.#messages = messages;
  }

  public async processMessage(
    envelope: WhatsappInboundMessageEnvelope,
  ): Promise<ProcessWhatsappEventResult> {
    const applicationId = required(envelope.applicationId, "applicationId");
    const integrationId = required(envelope.integrationId, "integrationId");
    const tenantId = required(envelope.tenantId, "tenantId");
    const { contact, message } = envelope.payload;

    if (message.type !== "text" || message.text?.body === undefined) {
      return { result: "IGNORED" };
    }

    const bsuid = contact?.user_id ?? contact?.bsuid;
    const phone = resolvePhone(contact?.wa_id, message.from);
    const canonicalType = bsuid === undefined ? "WHATSAPP_PHONE" : "WHATSAPP_BSUID";
    const canonicalValue = bsuid ?? phone ?? message.from;
    const result = await this.#messages.persistTextMessage({
      applicationId,
      ...(bsuid === undefined ? {} : { bsuid }),
      canonicalType,
      canonicalValue,
      ...(contact?.profile?.name === undefined ? {} : { displayName: contact.profile.name }),
      integrationId,
      messageId: `msg_${ulid()}`,
      occurredAt: new Date(Number(message.timestamp) * 1_000).toISOString(),
      ...(phone === undefined ? {} : { phoneE164: `+${phone}` }),
      providerMessageId: message.id,
      tenantId,
      text: message.text.body,
      ...(contact?.username === undefined ? {} : { username: contact.username }),
    });

    return { result };
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
