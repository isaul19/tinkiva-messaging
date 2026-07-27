import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CONTROL_TABLE = "messaging-control-test";
  process.env.WEBSOCKET_MANAGEMENT_ENDPOINT = "https://realtime.example/dev";
});

import type { RealtimeMessageEvent } from "../../../src/contracts/api/realtime.contract.js";
import { createRealtimeDispatcherHandler } from "../../../src/functions/realtime-dispatcher/handler.js";

const applicationEvent: RealtimeMessageEvent = {
  applicationId: "app_test",
  data: {
    conversationId: "conv_test",
    integrationId: "int_test",
    message: {
      conversationId: "conv_test",
      direction: "INBOUND",
      integrationId: "int_test",
      messageId: "msg_test",
      occurredAt: "2026-07-26T22:00:00.000Z",
      provider: "WHATSAPP",
      status: "RECEIVED",
      text: "Hola",
      type: "TEXT",
    },
  },
  eventId: "evt_test",
  occurredAt: "2026-07-26T22:00:00.000Z",
  schemaVersion: 1,
  tenantId: "tenant_test",
  type: "message.received",
};

const sqsEvent = {
  Records: [
    {
      body: JSON.stringify(applicationEvent),
      messageId: "sqs_message_test",
    },
  ],
} as SQSEvent;

describe("realtime dispatcher handler", () => {
  it("delivers only to the event tenant and removes gone connections", async () => {
    const store = {
      connect: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([
        {
          applicationId: "app_test",
          connectionId: "connection_active",
          expiresAt: Math.floor(Date.now() / 1_000) + 60,
          tenantId: "tenant_test",
        },
        {
          applicationId: "app_test",
          connectionId: "connection_gone",
          expiresAt: Math.floor(Date.now() / 1_000) + 60,
          tenantId: "tenant_test",
        },
      ]),
    };
    const sender = {
      send: vi.fn((connectionId: string) =>
        Promise.resolve(connectionId === "connection_gone" ? ("GONE" as const) : ("SENT" as const)),
      ),
    };
    const handler = createRealtimeDispatcherHandler({ sender, store });

    await expect(handler(sqsEvent)).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(store.list).toHaveBeenCalledWith("app_test", "tenant_test");
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(store.disconnect).toHaveBeenCalledWith("connection_gone");
  });
});
