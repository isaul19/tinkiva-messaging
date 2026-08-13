import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

import type { MediaEnrichmentJobPublisher } from "../../application/ports/media-enrichment-job-publisher.js";
import {
  mediaEnrichmentJobSchema,
  type MediaEnrichmentJob,
} from "../../contracts/queues/media-enrichment.contract.js";

export class SqsMediaEnrichmentJobPublisher implements MediaEnrichmentJobPublisher {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  public constructor(client: SQSClient, queueUrl: string) {
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  public async publish(job: MediaEnrichmentJob): Promise<void> {
    const parsed = mediaEnrichmentJobSchema.parse(job);

    await this.#client.send(
      new SendMessageCommand({
        MessageBody: JSON.stringify(parsed),
        QueueUrl: this.#queueUrl,
      }),
    );
  }
}
