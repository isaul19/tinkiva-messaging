import { describe, expect, it, vi } from "vitest";

import type { ApplicationEventPublisher } from "../../../src/application/ports/application-event-publisher.js";
import type { RealtimeMessageEvent } from "../../../src/contracts/api/realtime.contract.js";
import { RoutedApplicationEventPublisher } from "../../../src/infrastructure/sqs/routed-application-event-publisher.js";

const storagiaApplicationId = "app_storagia";

const receivedEvent = (overrides: Partial<RealtimeMessageEvent> = {}): RealtimeMessageEvent => ({
  applicationId: storagiaApplicationId,
  data: {
    conversationId: "conv_test",
    integrationId: "int_test",
    message: {
      conversationId: "conv_test",
      direction: "INBOUND",
      integrationId: "int_test",
      messageId: "msg_test",
      occurredAt: "2026-07-31T12:00:00.000Z",
      provider: "WHATSAPP",
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
  ...overrides,
});

const publishers = () => {
  const realtime = {
    publish: vi.fn<ApplicationEventPublisher["publish"]>().mockResolvedValue(undefined),
  };
  const storagiaAutomation = {
    publish: vi.fn<ApplicationEventPublisher["publish"]>().mockResolvedValue(undefined),
  };
  const publisher = new RoutedApplicationEventPublisher({
    realtime,
    storagiaApplicationId,
    storagiaAutomation,
  });

  return { publisher, realtime, storagiaAutomation };
};

describe("RoutedApplicationEventPublisher", () => {
  it("always publishes application events to realtime", async () => {
    const { publisher, realtime } = publishers();
    const event = receivedEvent({ applicationId: "app_other", type: "message.delivered" });

    await publisher.publish(event);

    expect(realtime.publish).toHaveBeenCalledOnce();
    expect(realtime.publish).toHaveBeenCalledWith(event);
  });

  it("publishes StoragIA inbound received messages to both destinations", async () => {
    const { publisher, realtime, storagiaAutomation } = publishers();
    const event = receivedEvent();

    await publisher.publish(event);

    expect(realtime.publish).toHaveBeenCalledWith(event);
    expect(storagiaAutomation.publish).toHaveBeenCalledWith(event);
  });

  it("does not route another application's event to StoragIA", async () => {
    const { publisher, storagiaAutomation } = publishers();

    await publisher.publish(receivedEvent({ applicationId: "app_other" }));

    expect(storagiaAutomation.publish).not.toHaveBeenCalled();
  });

  it("does not route outbound messages to StoragIA", async () => {
    const { publisher, storagiaAutomation } = publishers();
    const base = receivedEvent();

    await publisher.publish(
      receivedEvent({
        data: {
          ...base.data,
          message: { ...base.data.message, direction: "OUTBOUND" },
        },
      }),
    );

    expect(storagiaAutomation.publish).not.toHaveBeenCalled();
  });

  it("does not route other event types to StoragIA", async () => {
    const { publisher, storagiaAutomation } = publishers();

    await publisher.publish(receivedEvent({ type: "message.sent" }));

    expect(storagiaAutomation.publish).not.toHaveBeenCalled();
  });

  it("propagates a realtime publication failure", async () => {
    const { publisher, realtime, storagiaAutomation } = publishers();
    realtime.publish.mockRejectedValueOnce(new Error("realtime unavailable"));

    await expect(publisher.publish(receivedEvent())).rejects.toThrow("realtime unavailable");
    expect(storagiaAutomation.publish).toHaveBeenCalledOnce();
  });

  it("propagates a StoragIA publication failure", async () => {
    const { publisher, realtime, storagiaAutomation } = publishers();
    storagiaAutomation.publish.mockRejectedValueOnce(new Error("automation unavailable"));

    await expect(publisher.publish(receivedEvent())).rejects.toThrow("automation unavailable");
    expect(realtime.publish).toHaveBeenCalledOnce();
  });
});
