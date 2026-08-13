import { randomBytes } from "node:crypto";

import { ulid } from "ulid";

import type { WhatsappCredentialWriter } from "../ports/whatsapp-credential-vault.js";
import type { WhatsappIntegrationStore } from "../ports/whatsapp-integration-store.js";
import type { WhatsappManagementApi } from "../ports/whatsapp-management-api.js";
import type {
  RegisterWhatsappIntegrationRequest,
  WhatsappIntegrationResponse,
} from "../../contracts/api/whatsapp-integration.contract.js";
import { inboundMediaSettingsSchema } from "../../contracts/api/inbound-media.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface RegisterWhatsappIntegrationCommand {
  applicationId: string;
  request: RegisterWhatsappIntegrationRequest;
  tenantId: string;
}

export interface RegisterWhatsappIntegrationConfig {
  graphApiVersion: string;
  webhookBaseUrl: string;
}

export class RegisterWhatsappIntegration {
  readonly #credentials: Pick<WhatsappCredentialWriter, "create" | "deleteImmediately">;
  readonly #managementApi: Pick<WhatsappManagementApi, "getPhoneNumbers" | "subscribeWaba">;
  readonly #store: WhatsappIntegrationStore;
  readonly #config: RegisterWhatsappIntegrationConfig;

  public constructor(
    managementApi: Pick<WhatsappManagementApi, "getPhoneNumbers" | "subscribeWaba">,
    credentials: Pick<WhatsappCredentialWriter, "create" | "deleteImmediately">,
    store: WhatsappIntegrationStore,
    config: RegisterWhatsappIntegrationConfig,
  ) {
    this.#config = config;
    this.#credentials = credentials;
    this.#managementApi = managementApi;
    this.#store = store;
  }

  public async execute(
    command: RegisterWhatsappIntegrationCommand,
  ): Promise<WhatsappIntegrationResponse> {
    const phoneNumbers = await this.#managementApi.getPhoneNumbers({
      accessToken: command.request.accessToken,
      graphApiVersion: this.#config.graphApiVersion,
      wabaId: command.request.wabaId,
    });
    const phoneNumber = phoneNumbers.find(
      (candidate) => candidate.id === command.request.phoneNumberId,
    );

    if (phoneNumber === undefined) {
      throw new ApplicationError(
        "PROVIDER_CREDENTIAL_INVALID",
        "The WhatsApp phone number does not belong to the requested WABA.",
        400,
      );
    }

    const providerConnectionId = `pc_${ulid()}`;
    const integrationId = `int_${ulid()}`;
    const webhookKey = randomBytes(32).toString("base64url");
    const verifyToken = randomBytes(32).toString("base64url");
    const webhookUrl = `${this.#config.webhookBaseUrl.replace(/\/+$/, "")}/webhooks/whatsapp/${webhookKey}`;
    const inboundMedia = inboundMediaSettingsSchema.parse(command.request.inboundMedia);
    const credentialRef = await this.#credentials.create({
      accessToken: command.request.accessToken,
      applicationId: command.applicationId,
      appSecret: command.request.appSecret,
      providerConnectionId,
      tenantId: command.tenantId,
      verifyToken,
    });
    const createdAt = new Date().toISOString();

    try {
      await this.#store.createPending({
        applicationId: command.applicationId,
        ...(command.request.businessPortfolioId === undefined
          ? {}
          : { businessPortfolioId: command.request.businessPortfolioId }),
        createdAt,
        credentialRef,
        displayName: command.request.displayName,
        ...(phoneNumber.displayPhoneNumber === undefined
          ? {}
          : { displayPhoneNumber: phoneNumber.displayPhoneNumber }),
        graphApiVersion: this.#config.graphApiVersion,
        inboundMedia,
        integrationId,
        metaAppId: command.request.metaAppId,
        phoneNumberId: command.request.phoneNumberId,
        providerConnectionId,
        tenantId: command.tenantId,
        ...(phoneNumber.verifiedName === undefined
          ? {}
          : { verifiedName: phoneNumber.verifiedName }),
        wabaId: command.request.wabaId,
        webhookKey,
        webhookUrl,
      });
    } catch (error) {
      await this.#credentials.deleteImmediately(credentialRef);
      throw error;
    }

    try {
      await this.#managementApi.subscribeWaba({
        accessToken: command.request.accessToken,
        callbackUrl: webhookUrl,
        graphApiVersion: this.#config.graphApiVersion,
        verifyToken,
        wabaId: command.request.wabaId,
      });
      await this.#store.setStatus(
        integrationId,
        command.request.phoneNumberId,
        providerConnectionId,
        command.tenantId,
        command.request.wabaId,
        webhookKey,
        "ACTIVE",
        new Date().toISOString(),
      );
    } catch (error) {
      try {
        await this.#store.deletePending({
          integrationId,
          phoneNumberId: command.request.phoneNumberId,
          providerConnectionId,
          tenantId: command.tenantId,
          wabaId: command.request.wabaId,
          webhookKey,
        });
      } catch {
        await this.#store
          .setStatus(
            integrationId,
            command.request.phoneNumberId,
            providerConnectionId,
            command.tenantId,
            command.request.wabaId,
            webhookKey,
            "ERROR",
            new Date().toISOString(),
          )
          .catch(() => undefined);
        throw error;
      }

      await this.#credentials.deleteImmediately(credentialRef).catch(() => undefined);
      throw error;
    }

    return {
      credentialVersion: 1,
      displayName: command.request.displayName,
      ...(phoneNumber.displayPhoneNumber === undefined
        ? {}
        : { displayPhoneNumber: phoneNumber.displayPhoneNumber }),
      inboundMedia,
      integrationId,
      phoneNumberId: command.request.phoneNumberId,
      provider: "WHATSAPP",
      status: "ACTIVE",
      tenantId: command.tenantId,
      ...(phoneNumber.verifiedName === undefined ? {} : { verifiedName: phoneNumber.verifiedName }),
      webhookUrl,
    };
  }
}
