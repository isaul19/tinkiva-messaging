import { createHash } from "node:crypto";

import { Logger } from "@aws-lambda-powertools/logger";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { z } from "zod";

import type { ApplicationEventPublisher } from "../../application/ports/application-event-publisher.js";
import {
  type RealtimeMessageEvent,
  type RealtimeMessageEventType,
} from "../../contracts/api/realtime.contract.js";
import { SqsApplicationEventPublisher } from "../../infrastructure/sqs/sqs-application-event-publisher.js";
import { loadAppEventProjectorRuntimeConfig } from "../../shared/config/app-event-projector-runtime-config.js";

const logger = new Logger({
  serviceName: "app-event-projector",
});

const streamMessageSchema = z.looseObject({
  applicationId: z.string().min(1),
  conversationId: z.string().min(1),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  failureCode: z.string().min(1).optional(),
  integrationId: z.string().min(1),
  messageId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  provider: z.enum(["TELEGRAM", "WHATSAPP"]),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"]),
  statusUpdatedAt: z.iso.datetime().optional(),
  tenantId: z.string().min(1),
  text: z.string(),
  type: z.literal("TEXT"),
});

export interface AppEventProjectorHandlerDependencies {
  publisher: ApplicationEventPublisher;
}

export const createAppEventProjectorHandler =
  ({ publisher }: AppEventProjectorHandlerDependencies) =>
  async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];

    for (const record of event.Records) {
      try {
        const projected = projectRealtimeMessageEvent(record);
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

export const projectRealtimeMessageEvent = (
  record: DynamoDBRecord,
): RealtimeMessageEvent | undefined => {
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

  if (record.eventName === "MODIFY" && record.dynamodb.OldImage !== undefined) {
    const previous = streamMessageSchema.safeParse(
      unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>),
    );
    if (previous.success && previous.data.status === current.data.status) return undefined;
  }

  const message = current.data;

  return {
    applicationId: message.applicationId,
    data: {
      conversationId: message.conversationId,
      integrationId: message.integrationId,
      message: {
        conversationId: message.conversationId,
        direction: message.direction,
        ...(message.failureCode === undefined ? {} : { failureCode: message.failureCode }),
        integrationId: message.integrationId,
        messageId: message.messageId,
        occurredAt: message.occurredAt,
        provider: message.provider,
        status: message.status,
        text: message.text,
        type: message.type,
      },
    },
    eventId: deterministicEventId(record.eventID),
    occurredAt: message.statusUpdatedAt ?? message.occurredAt,
    schemaVersion: 1,
    tenantId: message.tenantId,
    type: eventTypeForStatus(message.status),
  };
};

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

export const main = createAppEventProjectorHandler({
  publisher: new SqsApplicationEventPublisher(new SQSClient({}), config.APP_EVENTS_QUEUE_URL),
});
