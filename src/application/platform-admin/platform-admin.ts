import type {
  DeletePlatformIntegrationOpenAiCredentialRequest,
  PlatformIntegrationDeletionRequest,
  PutPlatformIntegrationOpenAiCredentialRequest,
  UpdatePlatformIntegrationInboundMediaRequest,
} from "../../contracts/api/platform-admin.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import type { OpenAICredentialVault } from "../ports/openai-credential-vault.js";
import {
  OpenAICredentialUnavailableError,
  OpenAICredentialVersionConflictError,
} from "../ports/openai-credential-vault.js";
import type { PlatformAdminStore } from "../ports/platform-admin-store.js";

export class PlatformAdmin {
  readonly #store: PlatformAdminStore;
  readonly #credentialVault: OpenAICredentialVault;

  public constructor(store: PlatformAdminStore, credentialVault: OpenAICredentialVault) {
    this.#store = store;
    this.#credentialVault = credentialVault;
  }

  public listIntegrations(input: { cursor?: string }) {
    return this.#store.listIntegrations(input);
  }

  public updateInboundMedia(
    integrationId: string,
    request: UpdatePlatformIntegrationInboundMediaRequest,
  ) {
    return this.#store.updateInboundMedia({ integrationId, ...request });
  }

  public async putOpenAiCredential(
    integrationId: string,
    request: PutPlatformIntegrationOpenAiCredentialRequest,
  ) {
    try {
      return await this.#credentialVault.upsert({
        apiKey: request.apiKey,
        applicationId: request.applicationId,
        integrationId,
        tenantId: request.tenantId,
        ...(request.expectedCredentialVersion === undefined
          ? {}
          : { expectedCredentialVersion: request.expectedCredentialVersion }),
        ...(request.organization === undefined ? {} : { organization: request.organization }),
        ...(request.project === undefined ? {} : { project: request.project }),
      });
    } catch (error) {
      if (error instanceof OpenAICredentialVersionConflictError) {
        throw credentialVersionConflictError();
      }
      if (error instanceof OpenAICredentialUnavailableError) throw integrationNotFoundError();
      throw error;
    }
  }

  public async deleteOpenAiCredential(
    integrationId: string,
    request: DeletePlatformIntegrationOpenAiCredentialRequest,
  ) {
    try {
      return await this.#credentialVault.delete({ integrationId, ...request });
    } catch (error) {
      if (error instanceof OpenAICredentialVersionConflictError) {
        throw credentialVersionConflictError();
      }
      if (error instanceof OpenAICredentialUnavailableError) throw integrationNotFoundError();
      throw error;
    }
  }

  public async deleteIntegrationData(
    integrationId: string,
    request: PlatformIntegrationDeletionRequest,
  ) {
    if (request.confirmation !== integrationId) {
      throw new ApplicationError(
        "ADMIN_CONFIRMATION_INVALID",
        "The confirmation must exactly match the integration identifier.",
        400,
      );
    }

    return this.#store.deleteIntegrationData({
      applicationId: request.applicationId,
      integrationId,
      mode: request.mode,
      tenantId: request.tenantId,
    });
  }
}

const credentialVersionConflictError = (): ApplicationError =>
  new ApplicationError(
    "OPENAI_CREDENTIAL_VERSION_CONFLICT",
    "The OpenAI credential changed. Reload the integration before retrying.",
    409,
  );

const integrationNotFoundError = (): ApplicationError =>
  new ApplicationError("INTEGRATION_NOT_FOUND", "The messaging integration was not found.", 404);
