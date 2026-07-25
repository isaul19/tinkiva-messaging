import { timingSafeEqual } from "node:crypto";

import type { SecretReader } from "../ports/secret-reader.js";
import type { TelegramInboundPublisher } from "../ports/telegram-inbound-publisher.js";
import type { TelegramIntegrationReader } from "../ports/telegram-integration-reader.js";
import {
  telegramSecretSchema,
  type TelegramMessage,
  type TelegramUpdate,
} from "../../contracts/providers/telegram.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface ReceiveTelegramUpdateCommand {
  correlationId: string;
  secretToken: string | undefined;
  update: TelegramUpdate;
  webhookKey: string;
}

export interface ReceiveTelegramUpdateResult {
  accepted: true;
  enqueued: boolean;
}

export class ReceiveTelegramUpdate {
  readonly #integrations: TelegramIntegrationReader;
  readonly #publisher: TelegramInboundPublisher;
  readonly #secrets: SecretReader;

  public constructor(
    integrations: TelegramIntegrationReader,
    secrets: SecretReader,
    publisher: TelegramInboundPublisher,
  ) {
    this.#integrations = integrations;
    this.#secrets = secrets;
    this.#publisher = publisher;
  }

  public async execute(
    command: ReceiveTelegramUpdateCommand,
  ): Promise<ReceiveTelegramUpdateResult> {
    const integration = await this.#integrations.getByWebhookKey(command.webhookKey);

    if (integration?.status !== "ACTIVE") {
      throw new ApplicationError("WEBHOOK_NOT_FOUND", "The requested webhook does not exist.", 404);
    }

    const secret = await this.#secrets.getJson(integration.secretArn, telegramSecretSchema);

    if (!secretsMatch(secret.webhookSecretToken, command.secretToken)) {
      throw new ApplicationError(
        "WEBHOOK_SIGNATURE_INVALID",
        "The webhook credential is invalid.",
        401,
      );
    }

    const message = resolveMessage(command.update);

    if (message === undefined) {
      return {
        accepted: true,
        enqueued: false,
      };
    }

    await this.#publisher.publish({
      applicationId: integration.applicationId,
      chatId: String(message.chat.id),
      correlationId: command.correlationId,
      integrationId: integration.integrationId,
      receivedAt: new Date().toISOString(),
      tenantId: integration.tenantId,
      update: command.update,
    });

    return {
      accepted: true,
      enqueued: true,
    };
  }
}

const resolveMessage = (update: TelegramUpdate): TelegramMessage | undefined =>
  update.message ?? update.edited_message ?? update.callback_query?.message;

const secretsMatch = (expected: string, supplied: string | undefined): boolean => {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied ?? "", "utf8");
  const normalizedSupplied = Buffer.alloc(expectedBuffer.length);
  suppliedBuffer.copy(normalizedSupplied, 0, 0, expectedBuffer.length);

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(expectedBuffer, normalizedSupplied)
  );
};
