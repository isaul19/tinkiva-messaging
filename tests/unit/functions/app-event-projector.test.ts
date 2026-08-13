import { marshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBRecord } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_EVENTS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/app-events.fifo";
  process.env.MEDIA_BUCKET = "media-test";
  process.env.STORAGIA_AUTOMATION_APPLICATION_ID = "app_storagia";
  process.env.STORAGIA_AUTOMATION_QUEUE_URL =
    "https://sqs.us-east-1.amazonaws.com/123/storagia-automation.fifo";
});

import {
  createAppEventProjectorHandler,
  projectRealtimeMessageEvent,
} from "../../../src/functions/app-event-projector/handler.js";

const message = {
  applicationId: "app_test",
  conversationId: "conv_test",
  direction: "INBOUND",
  entityType: "MESSAGE",
  integrationId: "int_test",
  messageId: "msg_test",
  occurredAt: "2026-07-26T22:00:00.000Z",
  provider: "WHATSAPP",
  status: "RECEIVED",
  tenantId: "tenant_test",
  text: "Hola",
  type: "TEXT",
};

describe("projectRealtimeMessageEvent", () => {
  it("projects a durable inbound insert with the complete normalized message", () => {
    const result = projectRealtimeMessageEvent({
      dynamodb: {
        NewImage: marshall(message),
      },
      eventID: "stream-event-1",
      eventName: "INSERT",
    } as DynamoDBRecord);

    expect(result).toMatchObject({
      applicationId: "app_test",
      data: {
        conversationId: "conv_test",
        integrationId: "int_test",
        message: {
          messageId: "msg_test",
          status: "RECEIVED",
          text: "Hola",
        },
      },
      tenantId: "tenant_test",
      type: "message.received",
    });
    expect(result?.eventId).toMatch(/^evt_/);
    expect(
      projectRealtimeMessageEvent({
        dynamodb: {
          NewImage: marshall(message),
        },
        eventID: "stream-event-1",
        eventName: "INSERT",
      } as DynamoDBRecord)?.eventId,
    ).toBe(result?.eventId);
  });

  it("projects only real status transitions for modifications", () => {
    const sent = {
      ...message,
      direction: "OUTBOUND",
      status: "SENT",
      statusUpdatedAt: "2026-07-26T22:00:05.000Z",
    };
    const result = projectRealtimeMessageEvent({
      dynamodb: {
        NewImage: marshall(sent),
        OldImage: marshall({
          ...sent,
          status: "QUEUED",
        }),
      },
      eventID: "stream-event-2",
      eventName: "MODIFY",
    } as DynamoDBRecord);

    expect(result).toMatchObject({
      occurredAt: "2026-07-26T22:00:05.000Z",
      type: "message.sent",
    });

    expect(
      projectRealtimeMessageEvent({
        dynamodb: {
          NewImage: marshall(sent),
          OldImage: marshall(sent),
        },
        eventID: "stream-event-3",
        eventName: "MODIFY",
      } as DynamoDBRecord),
    ).toBeUndefined();
  });

  it("projects inbound locations with numeric coordinates", () => {
    const result = projectRealtimeMessageEvent({
      dynamodb: {
        NewImage: marshall(
          {
            ...message,
            latitude: 4.711,
            longitude: -74.0721,
            provider: "TELEGRAM",
            text: undefined,
            type: "LOCATION",
          },
          { removeUndefinedValues: true },
        ),
      },
      eventID: "stream-location-1",
      eventName: "INSERT",
    } as DynamoDBRecord);

    expect(result).toMatchObject({
      data: {
        message: {
          latitude: 4.711,
          longitude: -74.0721,
          type: "LOCATION",
        },
      },
      type: "message.received",
    });
  });

  it("projects inbound audio with a temporary playback URL", async () => {
    const storedMedia = {
      bucket: "media-test",
      key: "tenants/tenant_test/telegram/2026/08/08/msg_test/audio.ogg",
      mimeType: "audio/ogg",
      sha256: "a".repeat(64),
      sizeBytes: 1_024,
    };
    const temporaryDownloadUrl = vi.fn().mockResolvedValue("https://signed.example/audio.ogg");
    const result = await projectRealtimeMessageEvent(
      {
        dynamodb: {
          NewImage: marshall(
            {
              ...message,
              durationSeconds: 9,
              media: storedMedia,
              provider: "TELEGRAM",
              text: undefined,
              type: "AUDIO",
              voice: true,
            },
            { removeUndefinedValues: true },
          ),
        },
        eventID: "stream-audio-1",
        eventName: "INSERT",
      } as DynamoDBRecord,
      { temporaryDownloadUrl },
    );

    expect(result).toMatchObject({
      data: {
        message: {
          durationSeconds: 9,
          media: {
            mediaId: storedMedia.key,
            mimeType: "audio/ogg",
            url: "https://signed.example/audio.ogg",
          },
          type: "AUDIO",
          voice: true,
        },
      },
      type: "message.received",
    });
    expect(temporaryDownloadUrl).toHaveBeenCalledWith(storedMedia);
  });

  it("waits for requested media enrichment and projects the terminal update", async () => {
    const storedMedia = {
      bucket: "media-test",
      key: "tenants/tenant_test/whatsapp/2026/08/12/msg_test/image.jpg",
      mimeType: "image/jpeg",
      sha256: "b".repeat(64),
      sizeBytes: 2_048,
    };
    const pending = {
      ...message,
      media: storedMedia,
      metadata: { alternativeTextStatus: "PENDING" },
      text: undefined,
      type: "IMAGE",
    };
    const temporaryDownloadUrl = vi.fn().mockResolvedValue("https://signed.example/image.jpg");

    expect(
      projectRealtimeMessageEvent(
        {
          dynamodb: {
            NewImage: marshall(pending, { removeUndefinedValues: true }),
          },
          eventID: "stream-image-pending",
          eventName: "INSERT",
        } as DynamoDBRecord,
        { temporaryDownloadUrl },
      ),
    ).toBeUndefined();

    const result = await projectRealtimeMessageEvent(
      {
        dynamodb: {
          NewImage: marshall(
            {
              ...pending,
              metadata: {
                alternativeText: "Una factura fotografiada sobre una mesa.",
                alternativeTextStatus: "READY",
              },
            },
            { removeUndefinedValues: true },
          ),
          OldImage: marshall(pending, { removeUndefinedValues: true }),
        },
        eventID: "stream-image-ready",
        eventName: "MODIFY",
      } as DynamoDBRecord,
      { temporaryDownloadUrl },
    );

    expect(result).toMatchObject({
      data: {
        message: {
          metadata: { alternativeText: "Una factura fotografiada sobre una mesa." },
          type: "IMAGE",
        },
      },
      type: "message.received",
    });
  });

  it("reports a failed destination publication for DynamoDB Stream retry", async () => {
    const publish = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const handler = createAppEventProjectorHandler({ publisher: { publish } });
    const record = {
      dynamodb: {
        NewImage: marshall(message),
        SequenceNumber: "stream-sequence-1",
      },
      eventID: "stream-event-failure",
      eventName: "INSERT",
    } as DynamoDBRecord;

    await expect(handler({ Records: [record] })).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "stream-sequence-1" }],
    });
    expect(publish).toHaveBeenCalledOnce();
  });
});
