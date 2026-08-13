import type { MediaEnrichmentJob } from "../../contracts/queues/media-enrichment.contract.js";

export interface MediaEnrichmentJobPublisher {
  publish(job: MediaEnrichmentJob): Promise<void>;
}
