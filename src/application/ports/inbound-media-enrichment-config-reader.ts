import type { InboundMediaSettings } from "../../contracts/api/inbound-media.contract.js";

export interface InboundMediaEnrichmentConfigReaderInput {
  applicationId: string;
  integrationId: string;
  tenantId: string;
}

export interface InboundMediaEnrichmentConfig {
  inboundMedia: InboundMediaSettings;
}

export interface InboundMediaEnrichmentConfigReader {
  get(input: InboundMediaEnrichmentConfigReaderInput): Promise<InboundMediaEnrichmentConfig>;
}
