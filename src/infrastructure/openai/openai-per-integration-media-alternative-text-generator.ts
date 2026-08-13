import type { OpenAIAudioNormalizer } from "../../application/ports/audio-normalizer.js";
import type {
  AudioAlternativeTextGenerator,
  ImageAlternativeTextGenerator,
} from "../../application/ports/media-alternative-text.js";
import type { EnrichmentMediaReader, MediaReference } from "../../application/ports/media.js";
import type { OpenAICredentialReader } from "../../application/ports/openai-credential-vault.js";
import { OpenAIMediaAlternativeTextGenerator } from "./openai-media-alternative-text-generator.js";

export interface OpenAIPerIntegrationMediaAlternativeTextGeneratorConfig {
  audioModel: string;
  imageModel: string;
}

/** Resolves the tenant-owned credential before the generator is allowed to read media. */
export class OpenAIPerIntegrationMediaAlternativeTextGenerator
  implements AudioAlternativeTextGenerator, ImageAlternativeTextGenerator
{
  readonly #config: OpenAIPerIntegrationMediaAlternativeTextGeneratorConfig;
  readonly #credentials: OpenAICredentialReader;
  readonly #media: EnrichmentMediaReader;
  readonly #normalizer: OpenAIAudioNormalizer;

  public constructor(
    media: EnrichmentMediaReader,
    normalizer: OpenAIAudioNormalizer,
    credentials: OpenAICredentialReader,
    config: OpenAIPerIntegrationMediaAlternativeTextGeneratorConfig,
  ) {
    this.#media = media;
    this.#normalizer = normalizer;
    this.#credentials = credentials;
    this.#config = config;
  }

  public async generate(input: {
    applicationId: string;
    caption?: string;
    integrationId: string;
    media: MediaReference;
    tenantId: string;
  }): Promise<string> {
    const credential = await this.#credentials.get({
      applicationId: input.applicationId,
      integrationId: input.integrationId,
      tenantId: input.tenantId,
    });
    const generator = new OpenAIMediaAlternativeTextGenerator(this.#media, this.#normalizer, {
      apiKey: credential.apiKey,
      audioModel: this.#config.audioModel,
      imageModel: this.#config.imageModel,
      ...(credential.organization === undefined ? {} : { organization: credential.organization }),
      ...(credential.project === undefined ? {} : { project: credential.project }),
    });

    return generator.generate(input);
  }
}
