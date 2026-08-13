import { createHash } from "node:crypto";

import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { z } from "zod";

import type { ApplicationEventPublisher } from "../../application/ports/application-event-publisher.js";
import type { MediaUrlSigner } from "../../application/ports/media.js";
import {
  type RealtimeMessageEvent,
  type RealtimeMessageEventType,
} from "../../contracts/api/realtime.contract.js";
import { audioMimeTypeSchema } from "../../contracts/shared/audio.js";
import { latitudeSchema, longitudeSchema } from "../../contracts/shared/location.js";
import { s3Client } from "../../infrastructure/aws/clients.js";
import { S3MediaStore } from "../../infrastructure/s3/s3-media-store.js";
import { RoutedApplicationEventPublisher } from "../../infrastructure/sqs/routed-application-event-publisher.js";
import { SqsApplicationEventPublisher } from "../../infrastructure/sqs/sqs-application-event-publisher.js";
import { loadAppEventProjectorRuntimeConfig } from "../../shared/config/app-event-projector-runtime-config.js";

const logger = new Logger({
  serviceName: "app-event-projector",
});

const imageMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

const alternativeTextMetadataSchema = z.object({
  alternativeText: z.string().trim().min(1).max(4_000).optional(),
  alternativeTextStatus: z.enum(["FAILED", "PENDING", "READY"]).optional(),
});

const streamMessageSchema = z.looseObject({
  caption: z.string().max(1_024).optional(),
  applicationId: z.string().min(1),
  conversationId: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  durationSeconds: z.number().int().nonnegative().optional(),
  failureCode: z.string().min(1).optional(),
  integrationId: z.string().min(1),
  latitude: latitudeSchema.optional(),
  messageId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"]),
  statusUpdatedAt: z.iso.datetime().optional(),
  tenantId: z.string().min(1),
  media: z
    .object({
      bucket: z.string().min(1),
      key: z.string().min(1),
      mimeType: z.union([audioMimeTypeSchema, imageMimeTypeSchema]),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().positive(),
    })
    .optional(),
  metadata: alternativeTextMetadataSchema.optional(),
  longitude: longitudeSchema.optional(),
  text: z.string().optional(),
  type: z.enum(["AUDIO", "IMAGE", "LOCATION", "TEXT"]),
  voice: z.boolean().optional(),
});

export interface AppEventProjectorHandlerDependencies {
  media?: MediaUrlSigner;
  publisher: ApplicationEventPublisher;
}

export const createAppEventProjectorHandler =
  ({ media, publisher }: AppEventProjectorHandlerDependencies) =>
  async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        const projected =
          media === undefined
            ? projectRealtimeMessageEvent(record)
            : await projectRealtimeMessageEvent(record, media);
        if (projected !== undefined) await publisher.publish(projected);
      } catch (error) {
        logger.error("Failed to project a DynamoDB message event.", {
          error,
          eventId: record.eventID,
        });
        batchItemFailures.push({
          itemIdentifier: record.dynamodb?.SequenceNumber ?? record.eventID ?? "unknown",
        });
      }
    }

    return { batchItemFailures };
  };

export function projectRealtimeMessageEvent(
  record: DynamoDBRecord,
): RealtimeMessageEvent | undefined;
export function projectRealtimeMessageEvent(
  record: DynamoDBRecord,
  mediaSigner: MediaUrlSigner,
): Promise<RealtimeMessageEvent> | RealtimeMessageEvent | undefined;
export function projectRealtimeMessageEvent(
  record: DynamoDBRecord,
  mediaSigner?: MediaUrlSigner,
): Promise<RealtimeMessageEvent> | RealtimeMessageEvent | undefined {
  if (
    !["INSERT", "MODIFY"].includes(record.eventName ?? "") ||
    record.dynamodb?.NewImage === undefined ||
    record.eventID === undefined
  ) {
    return undefined;
  }

  const current = streamMessageSchema.safeParse(
    unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>),
  );

  if (!current.success) return undefined;
  const sourceEventId = record.eventID;

  if (record.eventName === "MODIFY" && record.dynamodb.OldImage !== undefined) {
    const previous = streamMessageSchema.safeParse(
      unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>),
    );
    if (previous.success && previous.data.status === current.data.status) {
      const enrichmentFinished =
        previous.data.metadata?.alternativeTextStatus === "PENDING" &&
        ["FAILED", "READY"].includes(current.data.metadata?.alternativeTextStatus ?? "");
      if (!enrichmentFinished) return undefined;
    }
  }

  const message = current.data;

  if (
    message.direction === "INBOUND" &&
    (message.type === "AUDIO" || message.type === "IMAGE") &&
    message.metadata?.alternativeTextStatus === "PENDING"
  ) {
    return undefined;
  }

  const common = {
    conversationId: message.conversationId,
    direction: message.direction,
    ...(message.failureCode === undefined ? {} : { failureCode: message.failureCode }),
    integrationId: message.integrationId,
    messageId: message.messageId,
    occurredAt: message.occurredAt,
    provider: message.provider,
    status: message.status,
  };
  const buildEvent = (
    projectedMessage: RealtimeMessageEvent["data"]["message"],
  ): RealtimeMessageEvent => ({
    applicationId: message.applicationId,
    data: {
      conversationId: message.conversationId,
      integrationId: message.integrationId,
      message: projectedMessage,
    },
    eventId: deterministicEventId(sourceEventId),
    occurredAt: message.statusUpdatedAt ?? message.occurredAt,
    schemaVersion: 1,
    tenantId: message.tenantId,
    type: eventTypeForStatus(message.status),
  });

  if (message.type === "TEXT") {
    if (message.text === undefined) return undefined;
    return buildEvent({ ...common, text: message.text, type: "TEXT" });
  }
  if (message.type === "LOCATION") {
    if (typeof message.latitude !== "number" || typeof message.longitude !== "number") {
      return undefined;
    }
    return buildEvent({
      ...common,
      latitude: message.latitude,
      longitude: message.longitude,
      type: "LOCATION",
    });
  }
  if (message.type === "AUDIO") {
    if (message.media === undefined || message.voice === undefined || mediaSigner === undefined) {
      return undefined;
    }
    const mimeType = audioMimeTypeSchema.safeParse(message.media.mimeType);
    if (!mimeType.success) return undefined;
    const storedMedia = message.media;
    const voice = message.voice;
    return mediaSigner.temporaryDownloadUrl(storedMedia).then((url) =>
      buildEvent({
        ...common,
        ...(message.caption === undefined ? {} : { caption: message.caption }),
        ...(message.durationSeconds === undefined
          ? {}
          : { durationSeconds: message.durationSeconds }),
        media: {
          mediaId: storedMedia.key,
          mimeType: mimeType.data,
          sha256: storedMedia.sha256,
          sizeBytes: storedMedia.sizeBytes,
          url,
        },
        ...(message.direction !== "INBOUND" || message.metadata?.alternativeText === undefined
          ? {}
          : { metadata: { alternativeText: message.metadata.alternativeText } }),
        type: "AUDIO",
        voice,
      }),
    );
  }
  if (message.media === undefined || mediaSigner === undefined) return undefined;
  const mimeType = imageMimeTypeSchema.safeParse(message.media.mimeType);
  if (!mimeType.success) return undefined;
  const storedMedia = message.media;
  return mediaSigner.temporaryDownloadUrl(storedMedia).then((url) =>
    buildEvent({
      ...common,
      ...(message.caption === undefined ? {} : { caption: message.caption }),
      media: {
        mediaId: storedMedia.key,
        mimeType: mimeType.data,
        sha256: storedMedia.sha256,
        sizeBytes: storedMedia.sizeBytes,
        url,
      },
      ...(message.direction !== "INBOUND" || message.metadata?.alternativeText === undefined
        ? {}
        : { metadata: { alternativeText: message.metadata.alternativeText } }),
      type: "IMAGE",
    }),
  );
}

const eventTypeForStatus = (
  status: z.infer<typeof streamMessageSchema>["status"],
): RealtimeMessageEventType => {
  const types: Record<typeof status, RealtimeMessageEventType> = {
    DELIVERED: "message.delivered",
    FAILED: "message.failed",
    QUEUED: "message.queued",
    READ: "message.read",
    RECEIVED: "message.received",
    SENT: "message.sent",
  };

  return types[status];
};

const deterministicEventId = (sourceEventId: string): string =>
  `evt_${createHash("sha256").update(sourceEventId, "utf8").digest("base64url").slice(0, 43)}`;

const config = loadAppEventProjectorRuntimeConfig();
const sqsClient = new SQSClient({});

export const main = createAppEventProjectorHandler({
  media: new S3MediaStore(s3Client, {
    bucket: config.MEDIA_BUCKET,
    urlTtlSeconds: config.MEDIA_URL_TTL_SECONDS,
  }),
  publisher: new RoutedApplicationEventPublisher({
    realtime: new SqsApplicationEventPublisher(sqsClient, config.APP_EVENTS_QUEUE_URL),
    storagiaApplicationId: config.STORAGIA_AUTOMATION_APPLICATION_ID,
    storagiaAutomation: new SqsApplicationEventPublisher(
      sqsClient,
      config.STORAGIA_AUTOMATION_QUEUE_URL,
    ),
  }),
});
