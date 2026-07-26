import type { MessageIntegrationReader } from "../ports/message-integration-reader.js";
import type { QueueTelegramMessage } from "./queue-telegram-message.js";
import type { QueueWhatsappMessage } from "./queue-whatsapp-message.js";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "../../contracts/api/message.contract.js";

export interface QueueMessageCommand {
  applicationId: string;
  correlationId: string;
  idempotencyKey: string;
  request: SendMessageRequest;
}

export class QueueMessage {
  readonly #integrations: MessageIntegrationReader;
  readonly #telegram: Pick<QueueTelegramMessage, "execute">;
  readonly #whatsapp: Pick<QueueWhatsappMessage, "execute">;

  public constructor(
    integrations: MessageIntegrationReader,
    telegram: Pick<QueueTelegramMessage, "execute">,
    whatsapp: Pick<QueueWhatsappMessage, "execute">,
  ) {
    this.#integrations = integrations;
    this.#telegram = telegram;
    this.#whatsapp = whatsapp;
  }

  public async execute(command: QueueMessageCommand): Promise<SendMessageResponse> {
    const provider = await this.#integrations.getProvider({
      applicationId: command.applicationId,
      integrationId: command.request.integrationId,
      tenantId: command.request.tenantId,
    });

    return provider === "TELEGRAM"
      ? this.#telegram.execute(command)
      : this.#whatsapp.execute(command);
  }
}
