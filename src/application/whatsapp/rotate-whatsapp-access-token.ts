import { ProviderCredentialVersionConflictError } from "../ports/provider-credential-vault-errors.js";
import type { WhatsappCredentialVault } from "../ports/whatsapp-credential-vault.js";
import type { WhatsappIntegrationAdminReader } from "../ports/whatsapp-integration-admin-reader.js";
import type { WhatsappManagementApi } from "../ports/whatsapp-management-api.js";
import type {
  RotateWhatsappCredentialRequest,
  RotateWhatsappCredentialResponse,
} from "../../contracts/api/whatsapp-integration.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

export interface RotateWhatsappAccessTokenCommand {
  applicationId: string;
  integrationId: string;
  request: RotateWhatsappCredentialRequest;
  tenantId: string;
}

const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];

export class RotateWhatsappAccessToken {
  readonly #credentials: WhatsappCredentialVault;
  readonly #integrations: WhatsappIntegrationAdminReader;
  readonly #managementApi: WhatsappManagementApi;

  public constructor(
    integrations: WhatsappIntegrationAdminReader,
    credentials: WhatsappCredentialVault,
    managementApi: WhatsappManagementApi,
  ) {
    this.#credentials = credentials;
    this.#integrations = integrations;
    this.#managementApi = managementApi;
  }

  public async execute(
    command: RotateWhatsappAccessTokenCommand,
  ): Promise<RotateWhatsappCredentialResponse> {
    const integration = await this.#integrations.get({
      applicationId: command.applicationId,
      integrationId: command.integrationId,
      tenantId: command.tenantId,
    });

    if (integration === undefined) {
      throw new ApplicationError(
        "INTEGRATION_NOT_FOUND",
        "The WhatsApp integration was not found.",
        404,
      );
    }

    if (integration.status !== "ACTIVE") {
      throw new ApplicationError(
        "INTEGRATION_DISABLED",
        "Only an active WhatsApp integration can rotate credentials.",
        409,
      );
    }

    const currentCredential = await this.#credentials.get(integration.providerConnectionId);
    const tokenMetadata = await this.#managementApi.inspectAccessToken({
      accessToken: command.request.accessToken,
      appId: integration.metaAppId,
      appSecret: currentCredential.appSecret,
      graphApiVersion: integration.graphApiVersion,
    });
    const missingScope = requiredScopes.some((scope) => !tokenMetadata.scopes.includes(scope));

    if (tokenMetadata.appId !== integration.metaAppId || missingScope) {
      throw new ApplicationError(
        "PROVIDER_CREDENTIAL_INVALID",
        "The token must belong to the registered Meta app and grant WhatsApp management and messaging permissions.",
        400,
      );
    }

    const phoneNumbers = await this.#managementApi.getPhoneNumbers({
      accessToken: command.request.accessToken,
      graphApiVersion: integration.graphApiVersion,
      wabaId: integration.wabaId,
    });

    if (!phoneNumbers.some((phoneNumber) => phoneNumber.id === integration.phoneNumberId)) {
      throw new ApplicationError(
        "PROVIDER_CREDENTIAL_INVALID",
        "The token cannot access the registered WhatsApp phone number.",
        400,
      );
    }

    try {
      const rotated = await this.#credentials.rotate({
        accessToken: command.request.accessToken,
        applicationId: command.applicationId,
        appSecret: currentCredential.appSecret,
        expectedCredentialVersion: command.request.expectedCredentialVersion,
        providerConnectionId: integration.providerConnectionId,
        tenantId: command.tenantId,
        verifyToken: currentCredential.verifyToken,
      });

      return {
        credentialVersion: rotated.credentialVersion,
        integrationId: integration.integrationId,
        provider: "WHATSAPP",
        status: "ACTIVE",
        tenantId: integration.tenantId,
        ...toOptionalIso("tokenDataAccessExpiresAt", tokenMetadata.dataAccessExpiresAt),
        ...toOptionalIso("tokenExpiresAt", tokenMetadata.expiresAt),
        ...(tokenMetadata.type === undefined ? {} : { tokenType: tokenMetadata.type }),
        updatedAt: rotated.updatedAt,
      };
    } catch (error) {
      if (error instanceof ProviderCredentialVersionConflictError) {
        throw new ApplicationError(
          "PROVIDER_CREDENTIAL_VERSION_CONFLICT",
          "The credential was already updated. Read the current version before retrying.",
          409,
        );
      }

      throw error;
    }
  }
}

const toOptionalIso = <TKey extends "tokenDataAccessExpiresAt" | "tokenExpiresAt">(
  key: TKey,
  seconds: number | undefined,
): Partial<Record<TKey, string>> =>
  seconds === undefined || seconds === 0
    ? {}
    : ({ [key]: new Date(seconds * 1_000).toISOString() } as Record<TKey, string>);
