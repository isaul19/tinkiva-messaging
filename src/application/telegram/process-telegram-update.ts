import { createHash } from "node:crypto";

import { ulid } from "ulid";

import type { TelegramMessageStore } from "../ports/telegram-message-store.js";
import type { TelegramInboundEnvelope } from "../../contracts/queues/telegram-inbound.contract.js";
import type { TelegramMessage } from "../../contracts/providers/telegram.contract.js";

export interface ProcessTelegramUpdateResult {
  result: "CREATED" | "DUPLICATE" | "IGNORED";
}

export class ProcessTelegramUpdate {
  readonly #messages: TelegramMessageStore;

  public constructor(messages: TelegramMessageStore) {
    this.#messages = messages;
  }

  public async execute(envelope: TelegramInboundEnvelope): Promise<ProcessTelegramUpdateResult> {
    const integrationId = required(envelope.integrationId, "integrationId");
    const tenantId = required(envelope.tenantId, "tenantId");
    const applicationId = required(envelope.applicationId, "applicationId");
    const message = resolveMessage(envelope.payload.update);

    if (message?.text === undefined) {
      return {
        result: "IGNORED",
      };
    }

    const chatId = String(message.chat.id);
    const conversationId = deterministicConversationId(integrationId, chatId);
    const displayName =
      message.from === undefined
        ? undefined
        : [message.from.first_name, message.from.last_name]
            .filter((part): part is string => part !== undefined)
            .join(" ");
    const result = await this.#messages.persistTextMessage({
      applicationId,
      chatId,
      ...(message.chat.title === undefined ? {} : { chatTitle: message.chat.title }),
      chatType: message.chat.type,
      conversationId,
      ...(displayName === undefined ? {} : { displayName }),
      integrationId,
      messageId: `msg_${ulid()}`,
      occurredAt: new Date(message.date * 1_000).toISOString(),
      providerMessageId: String(message.message_id),
      ...(message.from === undefined ? {} : { senderUserId: String(message.from.id) }),
      tenantId,
      text: message.text,
      updateId: String(envelope.payload.update.update_id),
      ...(message.from?.username === undefined ? {} : { username: message.from.username }),
    });

    return {
      result,
    };
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

const required = (value: string | undefined, fieldName: string): string => {
  if (value === undefined) {
    throw new Error(`Telegram inbound envelope is missing ${fieldName}.`);
  }

  return value;
};
