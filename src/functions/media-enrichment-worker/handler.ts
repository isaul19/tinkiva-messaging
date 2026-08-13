import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { Logger } from "@aws-lambda-powertools/logger";

import { ProcessAudioMediaEnrichmentJob } from "../../application/media/process-audio-media-enrichment-job.js";
import { ProcessImageMediaEnrichmentJob } from "../../application/media/process-image-media-enrichment-job.js";
import type { MediaEnrichmentStore } from "../../application/ports/media-enrichment-store.js";
import {
  mediaEnrichmentJobSchema,
  type MediaEnrichmentJob,
} from "../../contracts/queues/media-enrichment.contract.js";
import { dynamoDocumentClient, kmsClient, s3Client } from "../../infrastructure/aws/clients.js";
import { DynamoMediaEnrichmentStore } from "../../infrastructure/dynamodb/dynamo-media-enrichment-store.js";
import { KmsDynamoOpenAICredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-openai-credential-vault.js";
import { FfmpegOpenAIAudioNormalizer } from "../../infrastructure/media/ffmpeg-openai-audio-normalizer.js";
import { OpenAIPerIntegrationMediaAlternativeTextGenerator } from "../../infrastructure/openai/openai-per-integration-media-alternative-text-generator.js";
import { S3MediaStore } from "../../infrastructure/s3/s3-media-store.js";
import { loadMediaEnrichmentRuntimeConfig } from "../../shared/config/media-enrichment-runtime-config.js";

export interface MediaEnrichmentWorkerDependencies {
  audio: Pick<ProcessAudioMediaEnrichmentJob, "execute">;
  failure: Pick<MediaEnrichmentStore, "forceFail">;
  images: Pick<ProcessImageMediaEnrichmentJob, "execute">;
}

export interface MediaEnrichmentWorkerOptions {
  attemptTimeoutMs?: number;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 90_000;
const INITIALIZATION_TIMEOUT_MS = 10_000;
const MAX_RECEIVE_COUNT = 5;
const logger = new Logger({ serviceName: "media-enrichment-worker" });

export const createMediaEnrichmentWorkerHandler =
  (dependencies: MediaEnrichmentWorkerDependencies, options: MediaEnrichmentWorkerOptions = {}) =>
  async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    if (!Number.isSafeInteger(attemptTimeoutMs) || attemptTimeoutMs <= 0) {
      throw new RangeError("attemptTimeoutMs must be a positive safe integer.");
    }
    const results = await Promise.all(
      event.Records.map(async (record) => {
        let job: MediaEnrichmentJob | undefined;

        try {
          job = mediaEnrichmentJobSchema.parse(JSON.parse(record.body) as unknown);
          await withTimeout(
            job.type === "IMAGE"
              ? dependencies.images.execute(job)
              : dependencies.audio.execute(job),
            attemptTimeoutMs,
            "Media enrichment attempt timed out.",
          );
          return undefined;
        } catch (error) {
          const receiveCount = Number(record.attributes.ApproximateReceiveCount);
          logger.warn("Inbound media enrichment attempt failed.", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            messageId: job?.messageId,
            receiveCount,
            type: job?.type,
          });
          if (job !== undefined && receiveCount >= MAX_RECEIVE_COUNT) {
            try {
              await dependencies.failure.forceFail(job);
              // Preserve exhausted transient failures in the DLQ while releasing the message.
              return { itemIdentifier: record.messageId };
            } catch {
              // Keep the record failed so SQS can preserve it in the DLQ.
            }
          }

          return { itemIdentifier: record.messageId };
        }
      }),
    );

    return {
      batchItemFailures: results.filter(
        (result): result is { itemIdentifier: string } => result !== undefined,
      ),
    };
  };

export const main = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const config = loadMediaEnrichmentRuntimeConfig();
  const enrichmentStore = new DynamoMediaEnrichmentStore(
    dynamoDocumentClient,
    config.CONTROL_TABLE,
    config.DATA_TABLE,
  );

  try {
    const handler = await withTimeout(
      createDefaultHandler(config, enrichmentStore),
      INITIALIZATION_TIMEOUT_MS,
      "Media enrichment initialization timed out.",
    );
    return await handler(event);
  } catch (error) {
    // Credential bootstrap failures must follow the same retry/DLQ path as API failures so
    // inbound messages do not remain suppressed in PENDING forever.
    const bootstrapError =
      error instanceof Error
        ? error
        : new Error("Media enrichment initialization failed.", { cause: error });
    const unavailable = {
      execute: (): Promise<never> => Promise.reject(bootstrapError),
    };
    return await createMediaEnrichmentWorkerHandler({
      audio: unavailable,
      failure: enrichmentStore,
      images: unavailable,
    })(event);
  }
};

const createDefaultHandler = (
  config: ReturnType<typeof loadMediaEnrichmentRuntimeConfig>,
  enrichmentStore: DynamoMediaEnrichmentStore,
): Promise<(event: SQSEvent) => Promise<SQSBatchResponse>> => {
  const mediaStore = new S3MediaStore(s3Client, {
    bucket: config.MEDIA_BUCKET,
    urlTtlSeconds: config.MEDIA_URL_TTL_SECONDS,
  });
  const credentialVault = new KmsDynamoOpenAICredentialVault(dynamoDocumentClient, kmsClient, {
    keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
    stage: config.STAGE,
    tableName: config.CONTROL_TABLE,
  });
  const generator = new OpenAIPerIntegrationMediaAlternativeTextGenerator(
    mediaStore,
    new FfmpegOpenAIAudioNormalizer(),
    credentialVault,
    {
      audioModel: config.OPENAI_AUDIO_MODEL,
      imageModel: config.OPENAI_IMAGE_MODEL,
    },
  );

  return Promise.resolve(
    createMediaEnrichmentWorkerHandler({
      audio: new ProcessAudioMediaEnrichmentJob(generator, enrichmentStore),
      failure: enrichmentStore,
      images: new ProcessImageMediaEnrichmentJob(generator, enrichmentStore),
    }),
  );
};

const withTimeout = async <Result>(
  operation: Promise<Result>,
  timeoutMs: number,
  message: string,
): Promise<Result> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};
