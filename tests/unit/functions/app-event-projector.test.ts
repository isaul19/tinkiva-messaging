import { marshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBRecord } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.APP_EVENTS_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/app-events.fifo";
});

import { projectRealtimeMessageEvent } from "../../../src/functions/app-event-projector/handler.js";

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
});
