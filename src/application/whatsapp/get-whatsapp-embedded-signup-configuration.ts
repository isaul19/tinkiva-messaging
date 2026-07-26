import type { WhatsappEmbeddedSignupConfigurationReader } from "../ports/whatsapp-embedded-signup-configuration.js";
import type { WhatsappEmbeddedSignupConfigurationResponse } from "../../contracts/api/whatsapp-embedded-signup.contract.js";

export class GetWhatsappEmbeddedSignupConfiguration {
  readonly #config: {
    graphApiVersion: string;
  };
  readonly #configuration: WhatsappEmbeddedSignupConfigurationReader;

  public constructor(
    configuration: WhatsappEmbeddedSignupConfigurationReader,
    config: { graphApiVersion: string },
  ) {
    this.#config = config;
    this.#configuration = configuration;
  }

  public async execute(): Promise<WhatsappEmbeddedSignupConfigurationResponse> {
    const configuration = await this.#configuration.getPublic();

    if (configuration?.status !== "ACTIVE") {
      return {
        configured: false,
        graphApiVersion: this.#config.graphApiVersion,
      };
    }

    return {
      appId: configuration.appId,
      configurationId: configuration.configurationId,
      configured: true,
      graphApiVersion: this.#config.graphApiVersion,
    };
  }
}
