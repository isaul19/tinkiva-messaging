import type { WhatsappEmbeddedSignupApi } from "../ports/whatsapp-embedded-signup-api.js";
import type { WhatsappEmbeddedSignupConfigurationReader } from "../ports/whatsapp-embedded-signup-configuration.js";
import type { WhatsappManagementApi } from "../ports/whatsapp-management-api.js";
import type { RegisterWhatsappIntegration } from "./register-whatsapp-integration.js";
import type { CompleteWhatsappEmbeddedSignupRequest } from "../../contracts/api/whatsapp-embedded-signup.contract.js";
import type { WhatsappIntegrationResponse } from "../../contracts/api/whatsapp-integration.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];

export class CompleteWhatsappEmbeddedSignup {
  readonly #config: {
    graphApiVersion: string;
  };
  readonly #configuration: WhatsappEmbeddedSignupConfigurationReader;
  readonly #embeddedSignupApi: WhatsappEmbeddedSignupApi;
  readonly #managementApi: Pick<WhatsappManagementApi, "inspectAccessToken">;
  readonly #registerIntegration: Pick<RegisterWhatsappIntegration, "execute">;

  public constructor(
    configuration: WhatsappEmbeddedSignupConfigurationReader,
    embeddedSignupApi: WhatsappEmbeddedSignupApi,
    managementApi: Pick<WhatsappManagementApi, "inspectAccessToken">,
    registerIntegration: Pick<RegisterWhatsappIntegration, "execute">,
    config: { graphApiVersion: string },
  ) {
    this.#config = config;
    this.#configuration = configuration;
    this.#embeddedSignupApi = embeddedSignupApi;
    this.#managementApi = managementApi;
    this.#registerIntegration = registerIntegration;
  }

  public async execute(input: {
    applicationId: string;
    request: CompleteWhatsappEmbeddedSignupRequest;
    tenantId: string;
  }): Promise<WhatsappIntegrationResponse> {
    const configuration = await this.#configuration.get();

    if (configuration?.status !== "ACTIVE") {
      throw new ApplicationError(
        "PROVIDER_CONFIGURATION_INVALID",
        "WhatsApp Embedded Signup is not configured for this gateway stage.",
        409,
      );
    }

    const exchanged = await this.#embeddedSignupApi.exchangeAuthorizationCode({
      appId: configuration.appId,
      appSecret: configuration.appSecret,
      authorizationCode: input.request.authorizationCode,
      graphApiVersion: this.#config.graphApiVersion,
    });
    const metadata = await this.#managementApi.inspectAccessToken({
      accessToken: exchanged.accessToken,
      appId: configuration.appId,
      appSecret: configuration.appSecret,
      graphApiVersion: this.#config.graphApiVersion,
    });
    const missingScope = requiredScopes.some((scope) => !metadata.scopes.includes(scope));

    if (metadata.appId !== configuration.appId || missingScope) {
      throw new ApplicationError(
        "PROVIDER_CREDENTIAL_INVALID",
        "Meta issued a token for another app or without the required WhatsApp permissions.",
        400,
      );
    }

    return this.#registerIntegration.execute({
      applicationId: input.applicationId,
      request: {
        accessToken: exchanged.accessToken,
        appSecret: configuration.appSecret,
        ...(input.request.businessPortfolioId === undefined
          ? {}
          : { businessPortfolioId: input.request.businessPortfolioId }),
        displayName: input.request.displayName,
        metaAppId: configuration.appId,
        phoneNumberId: input.request.phoneNumberId,
        wabaId: input.request.wabaId,
      },
      tenantId: input.tenantId,
    });
  }
}
