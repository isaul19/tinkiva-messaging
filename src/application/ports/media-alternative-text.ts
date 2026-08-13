import type { MediaReference } from "./media.js";

export interface AudioAlternativeTextGenerator {
  generate(input: {
    applicationId: string;
    integrationId: string;
    media: MediaReference;
    tenantId: string;
  }): Promise<string>;
}

export interface ImageAlternativeTextGenerator {
  generate(input: {
    applicationId: string;
    caption?: string;
    integrationId: string;
    media: MediaReference;
    tenantId: string;
  }): Promise<string>;
}
