import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

import type {
  CompleteMediaEnrichmentInput,
  MediaEnrichmentClaim,
  MediaEnrichmentStore,
  MediaEnrichmentUpdateResult,
} from "../../application/ports/media-enrichment-store.js";
import type { MediaEnrichmentJob } from "../../contracts/queues/media-enrichment.contract.js";

const conditionExpression =
  "attribute_exists(PK) AND entityType = :entityType AND " +
  "applicationId = :applicationId AND tenantId = :tenantId AND " +
  "integrationId = :integrationId AND conversationId = :conversationId AND " +
  "messageId = :messageId AND #direction = :direction AND #type = :type AND " +
  "#media.#bucket = :mediaBucket AND #media.#key = :mediaKey AND " +
  "#media.#mimeType = :mediaMimeType AND #media.#sha256 = :mediaSha256 AND " +
  "#media.#sizeBytes = :mediaSizeBytes AND " +
  "#metadata.#alternativeTextStatus = :pending";

const claimedConditionExpression = conditionExpression + " AND #leaseId = :leaseId";

const attributeNames = {
  "#alternativeTextStatus": "alternativeTextStatus",
  "#direction": "direction",
  "#bucket": "bucket",
  "#key": "key",
  "#leaseExpiresAt": "mediaEnrichmentLeaseExpiresAt",
  "#leaseId": "mediaEnrichmentLeaseId",
  "#media": "media",
  "#mimeType": "mimeType",
  "#metadata": "metadata",
  "#sha256": "sha256",
  "#sizeBytes": "sizeBytes",
  "#type": "type",
};

export class DynamoMediaEnrichmentStore implements MediaEnrichmentStore {
  readonly #client: DynamoDBDocumentClient;
  readonly #controlTable: string;
  readonly #tableName: string;
  readonly #leaseDurationMs: number;

  public constructor(
    client: DynamoDBDocumentClient,
    controlTable: string,
    tableName: string,
    options: { leaseDurationMs?: number } = {},
  ) {
    this.#client = client;
    this.#controlTable = controlTable;
    this.#tableName = tableName;
    this.#leaseDurationMs = options.leaseDurationMs ?? 2 * 60 * 1_000;
    if (!Number.isSafeInteger(this.#leaseDurationMs) || this.#leaseDurationMs <= 0) {
      throw new RangeError("leaseDurationMs must be a positive safe integer.");
    }
  }

  public async claim(job: MediaEnrichmentJob): Promise<MediaEnrichmentClaim | "IGNORED"> {
    const leaseId = randomUUID();
    const now = Date.now();
    const values = this.#conditionValues(job, {
      ":leaseExpiresAt": now + this.#leaseDurationMs,
      ":leaseId": leaseId,
      ":now": now,
    });
    const flag = job.type === "AUDIO" ? "audioAlternativeText" : "imageAlternativeText";
    try {
      await this.#client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                ConditionExpression:
                  "applicationId = :applicationId AND tenantId = :tenantId AND " +
                  "integrationId = :integrationId AND entityType = :integrationEntityType " +
                  "AND #status = :active AND #inboundMedia.#flag = :enabled " +
                  "AND openAiCredential.configured = :enabled",
                ExpressionAttributeNames: {
                  "#flag": flag,
                  "#inboundMedia": "inboundMedia",
                  "#status": "status",
                },
                ExpressionAttributeValues: {
                  ":active": "ACTIVE",
                  ":applicationId": job.applicationId,
                  ":enabled": true,
                  ":integrationEntityType": "CHANNEL_INTEGRATION",
                  ":integrationId": job.integrationId,
                  ":tenantId": job.tenantId,
                },
                Key: { PK: `INTEGRATION#${job.integrationId}`, SK: "META" },
                TableName: this.#controlTable,
              },
            },
            {
              ConditionCheck: {
                ConditionExpression:
                  "applicationId = :applicationId AND tenantId = :tenantId AND " +
                  "integrationId = :integrationId AND entityType = :credentialEntityType",
                ExpressionAttributeValues: {
                  ":applicationId": job.applicationId,
                  ":credentialEntityType": "OPENAI_CREDENTIAL",
                  ":integrationId": job.integrationId,
                  ":tenantId": job.tenantId,
                },
                Key: { PK: `INTEGRATION#${job.integrationId}`, SK: "OPENAI_CREDENTIAL" },
                TableName: this.#controlTable,
              },
            },
            {
              Update: {
                ConditionExpression:
                  conditionExpression +
                  " AND (attribute_not_exists(#leaseExpiresAt) OR #leaseExpiresAt < :now)",
                ExpressionAttributeNames: attributeNames,
                ExpressionAttributeValues: values,
                Key: {
                  PK: `CONVERSATION#${job.conversationId}`,
                  SK: job.messageSortKey,
                },
                TableName: this.#tableName,
                UpdateExpression: "SET #leaseId = :leaseId, #leaseExpiresAt = :leaseExpiresAt",
              },
            },
          ],
        }),
      );
      return { leaseId };
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed") ===
          true
      ) {
        return "IGNORED";
      }
      throw error;
    }
  }

  public async complete(input: CompleteMediaEnrichmentInput): Promise<MediaEnrichmentUpdateResult> {
    const alternativeText = input.alternativeText.trim();

    if (alternativeText.length === 0 || alternativeText.length > 4_000) {
      throw new RangeError("alternativeText must contain between 1 and 4000 characters.");
    }

    return this.#update(
      input.job,
      "SET #metadata = :metadata REMOVE #leaseId, #leaseExpiresAt",
      {
        ":leaseId": input.claim.leaseId,
        ":metadata": {
          alternativeText,
          alternativeTextStatus: "READY",
        },
      },
      true,
    );
  }

  public async fail(
    job: MediaEnrichmentJob,
    claim: MediaEnrichmentClaim,
  ): Promise<MediaEnrichmentUpdateResult> {
    return this.#update(
      job,
      "SET #metadata.#alternativeTextStatus = :failed REMOVE #leaseId, #leaseExpiresAt",
      {
        ":failed": "FAILED",
        ":leaseId": claim.leaseId,
      },
      true,
    );
  }

  /** Last-resort timeout recovery after SQS has exhausted all deliveries. */
  public async forceFail(job: MediaEnrichmentJob): Promise<MediaEnrichmentUpdateResult> {
    return this.#update(
      job,
      "SET #metadata.#alternativeTextStatus = :failed REMOVE #leaseId, #leaseExpiresAt",
      { ":failed": "FAILED" },
    );
  }

  public async release(
    job: MediaEnrichmentJob,
    claim: MediaEnrichmentClaim,
  ): Promise<MediaEnrichmentUpdateResult> {
    return this.#update(
      job,
      "REMOVE #leaseId, #leaseExpiresAt",
      { ":leaseId": claim.leaseId },
      true,
    );
  }

  async #update(
    job: MediaEnrichmentJob,
    updateExpression: string,
    extraValues: Record<string, unknown>,
    requireClaim = false,
  ): Promise<MediaEnrichmentUpdateResult> {
    try {
      await this.#client.send(
        new UpdateCommand({
          ConditionExpression: requireClaim ? claimedConditionExpression : conditionExpression,
          ExpressionAttributeNames: attributeNames,
          ExpressionAttributeValues: this.#conditionValues(job, extraValues),
          Key: {
            PK: `CONVERSATION#${job.conversationId}`,
            SK: job.messageSortKey,
          },
          TableName: this.#tableName,
          UpdateExpression: updateExpression,
        }),
      );

      return "UPDATED";
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return "IGNORED";
      throw error;
    }
  }

  #conditionValues(
    job: MediaEnrichmentJob,
    extraValues: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ":applicationId": job.applicationId,
      ":conversationId": job.conversationId,
      ":direction": "INBOUND",
      ":entityType": "MESSAGE",
      ":integrationId": job.integrationId,
      ":mediaBucket": job.media.bucket,
      ":mediaKey": job.media.key,
      ":mediaMimeType": job.media.mimeType,
      ":mediaSha256": job.media.sha256,
      ":mediaSizeBytes": job.media.sizeBytes,
      ":messageId": job.messageId,
      ":pending": "PENDING",
      ":tenantId": job.tenantId,
      ":type": job.type,
      ...extraValues,
    };
  }
}
