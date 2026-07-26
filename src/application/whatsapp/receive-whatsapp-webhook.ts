import { createHmac, timingSafeEqual } from "node:crypto";

import type { WhatsappCredentialReader } from "../ports/whatsapp-credential-vault.js";
import type { WhatsappInboundPublisher } from "../ports/whatsapp-inbound-publisher.js";
import type { WhatsappIntegrationReader } from "../ports/whatsapp-integration-reader.js";
import type {
  WhatsappContact,
  WhatsappWebhookPayload,
} from "../../contracts/providers/whatsapp.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface VerifyWhatsappChallengeCommand {
  challenge: string | undefined;
  mode: string | undefined;
  verifyToken: string | undefined;
  webhookKey: string;
}

export interface ReceiveWhatsappWebhookCommand {
  correlationId: string;
  payload: WhatsappWebhookPayload;
  rawBody: Buffer;
  signature: string | undefined;
  webhookKey: string;
}

export interface ReceiveWhatsappWebhookResult {
  accepted: true;
  enqueuedMessages: number;
  enqueuedStatuses: number;
}

export class ReceiveWhatsappWebhook {
  readonly #credentials: WhatsappCredentialReader;
  readonly #integrations: WhatsappIntegrationReader;
  readonly #publisher: WhatsappInboundPublisher;

  public constructor(
    integrations: WhatsappIntegrationReader,
    credentials: WhatsappCredentialReader,
    publisher: WhatsappInboundPublisher,
  ) {
    this.#credentials = credentials;
    this.#integrations = integrations;
    this.#publisher = publisher;
  }

  public async verifyChallenge(command: VerifyWhatsappChallengeCommand): Promise<string> {
    const connection = await this.#integrations.getByWebhookKey(command.webhookKey);

    if (connection === undefined || !["ACTIVE", "PENDING"].includes(connection.status)) {
      throw webhookNotFoundError();
    }

    const credential = await this.#credentials.get(connection.credentialRef);

    if (
      command.mode !== "subscribe" ||
      command.challenge === undefined ||
      command.challenge.length === 0 ||
      command.challenge.length > 255 ||
      !constantTimeTextMatch(credential.verifyToken, command.verifyToken)
    ) {
      throw new ApplicationError(
        "WEBHOOK_VERIFICATION_INVALID",
        "The WhatsApp webhook verification request is invalid.",
        403,
      );
    }

    return command.challenge;
  }

  public async receive(
    command: ReceiveWhatsappWebhookCommand,
  ): Promise<ReceiveWhatsappWebhookResult> {
    const connection = await this.#integrations.getByWebhookKey(command.webhookKey);

    if (connection?.status !== "ACTIVE") {
      throw webhookNotFoundError();
    }

    const credential = await this.#credentials.get(connection.credentialRef);

    if (!signatureMatches(credential.appSecret, command.rawBody, command.signature)) {
      throw new ApplicationError(
        "WEBHOOK_SIGNATURE_INVALID",
        "The WhatsApp webhook signature is invalid.",
        401,
      );
    }

    let enqueuedMessages = 0;
    let enqueuedStatuses = 0;
    const receivedAt = new Date().toISOString();

    for (const entry of command.payload.entry) {
      for (const change of entry.changes) {
        const phoneNumberId = change.value.metadata.phone_number_id;
        const integration = await this.#integrations.getByPhoneNumberId(phoneNumberId);

        if (
          integration?.status !== "ACTIVE" ||
          integration.providerConnectionId !== connection.providerConnectionId ||
          integration.applicationId !== connection.applicationId ||
          integration.tenantId !== connection.tenantId
        ) {
          throw webhookNotFoundError();
        }

        for (const message of change.value.messages ?? []) {
          const contact = resolveContact(change.value.contacts, message.from);
          await this.#publisher.publish({
            applicationId: integration.applicationId,
            ...(contact === undefined ? {} : { contact }),
            correlationId: command.correlationId,
            integrationId: integration.integrationId,
            kind: "MESSAGE",
            message,
            phoneNumberId,
            receivedAt,
            tenantId: integration.tenantId,
          });
          enqueuedMessages += 1;
        }

        for (const status of change.value.statuses ?? []) {
          await this.#publisher.publish({
            applicationId: integration.applicationId,
            correlationId: command.correlationId,
            integrationId: integration.integrationId,
            kind: "STATUS",
            phoneNumberId,
            receivedAt,
            status,
            tenantId: integration.tenantId,
          });
          enqueuedStatuses += 1;
        }
      }
    }

    return {
      accepted: true,
      enqueuedMessages,
      enqueuedStatuses,
    };
  }
}

const resolveContact = (
  contacts: WhatsappContact[] | undefined,
  senderId: string,
): WhatsappContact | undefined =>
  contacts?.find(
    (contact) =>
      contact.wa_id === senderId || contact.bsuid === senderId || contact.user_id === senderId,
  ) ?? contacts?.[0];

const signatureMatches = (
  appSecret: string,
  rawBody: Buffer,
  supplied: string | undefined,
): boolean => {
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

  return constantTimeTextMatch(expected, supplied);
};

const constantTimeTextMatch = (expected: string, supplied: string | undefined): boolean => {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(supplied ?? "", "utf8");
  const normalizedSupplied = Buffer.alloc(expectedBuffer.length);
  suppliedBuffer.copy(normalizedSupplied, 0, 0, expectedBuffer.length);

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(expectedBuffer, normalizedSupplied)
  );
};

const webhookNotFoundError = (): ApplicationError =>
  new ApplicationError("WEBHOOK_NOT_FOUND", "The requested webhook does not exist.", 404);
