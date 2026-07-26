import { randomBytes } from "node:crypto";

import { ulid } from "ulid";

import type { WhatsappCredentialWriter } from "../ports/whatsapp-credential-vault.js";
import type { WhatsappIntegrationStore } from "../ports/whatsapp-integration-store.js";
import type { WhatsappManagementApi } from "../ports/whatsapp-management-api.js";
import type {
  RegisterWhatsappIntegrationRequest,
  WhatsappIntegrationResponse,
} from "../../contracts/api/whatsapp-integration.contract.js";
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
  readonly #credentials: WhatsappCredentialWriter;
  readonly #managementApi: WhatsappManagementApi;
  readonly #store: WhatsappIntegrationStore;
  readonly #config: RegisterWhatsappIntegrationConfig;

  public constructor(
    managementApi: WhatsappManagementApi,
    credentials: WhatsappCredentialWriter,
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
      await this.#store.setStatus(
        integrationId,
        command.request.phoneNumberId,
        providerConnectionId,
        command.tenantId,
        command.request.wabaId,
        webhookKey,
        "ERROR",
        new Date().toISOString(),
      );
      throw error;
    }

    return {
      displayName: command.request.displayName,
      ...(phoneNumber.displayPhoneNumber === undefined
        ? {}
        : { displayPhoneNumber: phoneNumber.displayPhoneNumber }),
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
