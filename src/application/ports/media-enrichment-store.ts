import type { MediaEnrichmentJob } from "../../contracts/queues/media-enrichment.contract.js";

export type MediaEnrichmentUpdateResult = "IGNORED" | "UPDATED";

export interface MediaEnrichmentClaim {
  leaseId: string;
}

export interface CompleteMediaEnrichmentInput {
  alternativeText: string;
  claim: MediaEnrichmentClaim;
  job: MediaEnrichmentJob;
}

export interface MediaEnrichmentStore {
  claim(job: MediaEnrichmentJob): Promise<MediaEnrichmentClaim | "IGNORED">;
  complete(input: CompleteMediaEnrichmentInput): Promise<MediaEnrichmentUpdateResult>;
  fail(job: MediaEnrichmentJob, claim: MediaEnrichmentClaim): Promise<MediaEnrichmentUpdateResult>;
  forceFail(job: MediaEnrichmentJob): Promise<MediaEnrichmentUpdateResult>;
  release(
    job: MediaEnrichmentJob,
    claim: MediaEnrichmentClaim,
  ): Promise<MediaEnrichmentUpdateResult>;
}
