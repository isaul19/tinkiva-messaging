import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it, vi } from "vitest";

import type { RealtimeMessageEvent } from "../../../src/contracts/api/realtime.contract.js";
import { SqsApplicationEventPublisher } from "../../../src/infrastructure/sqs/sqs-application-event-publisher.js";

const event: RealtimeMessageEvent = {
  applicationId: "app_storagia",
  data: {
    conversationId: "conv_test",
    integrationId: "int_test",
    message: {
      conversationId: "conv_test",
      direction: "INBOUND",
      integrationId: "int_test",
      messageId: "msg_test",
      occurredAt: "2026-07-31T12:00:00.000Z",
      provider: "TELEGRAM",
      status: "RECEIVED",
      text: "Hola",
      type: "TEXT",
    },
  },
  eventId: "evt_test",
  occurredAt: "2026-07-31T12:00:00.000Z",
  schemaVersion: 1,
  tenantId: "tenant_test",
  type: "message.received",
};

describe("SqsApplicationEventPublisher", () => {
  it("preserves event identity, deduplication and conversation ordering across retries", async () => {
    const send = vi.fn().mockResolvedValue({});
    const publisher = new SqsApplicationEventPublisher(
      { send } as unknown as SQSClient,
      "https://sqs.us-east-1.amazonaws.com/123/automation.fifo",
    );

    await Promise.all([publisher.publish(event), publisher.publish(event)]);

    const inputs = send.mock.calls.map(([command]) => {
      expect(command).toBeInstanceOf(SendMessageCommand);
      return (command as SendMessageCommand).input;
    });
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.MessageDeduplicationId).toBe(inputs[1]?.MessageDeduplicationId);
    expect(inputs[0]?.MessageGroupId).toBe("app_storagia:tenant_test:conv_test");
    expect(inputs[1]?.MessageGroupId).toBe(inputs[0]?.MessageGroupId);
    expect(JSON.parse(inputs[0]?.MessageBody ?? "{}")).toMatchObject({ eventId: "evt_test" });
    expect(JSON.parse(inputs[1]?.MessageBody ?? "{}")).toMatchObject({ eventId: "evt_test" });
  });
});
