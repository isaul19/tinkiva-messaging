import type { InboundMediaEnrichmentConfigReader } from "../ports/inbound-media-enrichment-config-reader.js";
import type { MediaReference } from "../ports/media.js";

export interface ResolveInboundMediaEnrichmentInput {
  applicationId: string;
  caption?: string;
  conversationId: string;
  integrationId: string;
  media: MediaReference;
  messageId: string;
  messageSortKey: string;
  tenantId: string;
  type: "AUDIO" | "IMAGE";
}

export class ResolveInboundMediaEnrichment {
  readonly #config: InboundMediaEnrichmentConfigReader;

  public constructor(config: InboundMediaEnrichmentConfigReader) {
    this.#config = config;
  }

  public async requested(input: ResolveInboundMediaEnrichmentInput): Promise<boolean> {
    const config = await this.#config.get(input);

    return input.type === "AUDIO"
      ? config.inboundMedia.audioAlternativeText
      : config.inboundMedia.imageAlternativeText;
  }
}
