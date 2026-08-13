import type { ImageAlternativeTextGenerator } from "../ports/media-alternative-text.js";
import type { MediaEnrichmentStore } from "../ports/media-enrichment-store.js";
import type { ImageMediaEnrichmentJob } from "../../contracts/queues/media-enrichment.contract.js";
import { isPermanentMediaGenerationError } from "./is-permanent-media-generation-error.js";

export type ImageMediaEnrichmentResult = "COMPLETED" | "FAILED" | "IGNORED";

export class ProcessImageMediaEnrichmentJob {
  readonly #generator: ImageAlternativeTextGenerator;
  readonly #store: MediaEnrichmentStore;

  public constructor(generator: ImageAlternativeTextGenerator, store: MediaEnrichmentStore) {
    this.#generator = generator;
    this.#store = store;
  }

  public async execute(job: ImageMediaEnrichmentJob): Promise<ImageMediaEnrichmentResult> {
    const claim = await this.#store.claim(job);
    if (claim === "IGNORED") return "IGNORED";
    let alternativeText: string;

    try {
      alternativeText = await this.#generator.generate({
        applicationId: job.applicationId,
        ...(job.caption === undefined ? {} : { caption: job.caption }),
        integrationId: job.integrationId,
        media: job.media,
        tenantId: job.tenantId,
      });
    } catch (error) {
      if (!isPermanentMediaGenerationError(error)) {
        await this.#store.release(job, claim);
        throw error;
      }
      const update = await this.#store.fail(job, claim);
      return update === "UPDATED" ? "FAILED" : "IGNORED";
    }

    const update = await this.#store.complete({ alternativeText, claim, job });
    return update === "UPDATED" ? "COMPLETED" : "IGNORED";
  }
}
