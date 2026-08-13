import type { SQSEvent } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { createMediaEnrichmentWorkerHandler } from "../../../src/functions/media-enrichment-worker/handler.js";

const imageJob = {
  applicationId: "app_test",
  conversationId: "conv_test",
  integrationId: "int_test",
  media: {
    bucket: "media-bucket",
    key: "tenants/tenant_test/image.jpg",
    mimeType: "image/jpeg",
    sha256: "a".repeat(64),
    sizeBytes: 100,
  },
  messageId: "msg_test",
  messageSortKey: "MESSAGE#2026-08-12T12:00:00.000Z#msg_test",
  tenantId: "tenant_test",
  type: "IMAGE",
} as const;

const sqsEvent = (body: string, receiveCount = "1"): SQSEvent =>
  ({
    Records: [
      {
        attributes: { ApproximateReceiveCount: receiveCount },
        body,
        messageId: "sqs_message_test",
      },
    ],
  }) as unknown as SQSEvent;

describe("media enrichment worker", () => {
  it("dispatches a valid image job", async () => {
    const execute = vi.fn().mockResolvedValue("COMPLETED");
    const handler = createMediaEnrichmentWorkerHandler({
      audio: { execute: vi.fn() },
      failure: { forceFail: vi.fn() },
      images: { execute },
    });

    await expect(handler(sqsEvent(JSON.stringify(imageJob)))).resolves.toEqual({
      batchItemFailures: [],
    });
    expect(execute).toHaveBeenCalledWith(imageJob);
  });

  it("retries transient failures before the queue redrive limit", async () => {
    const fail = vi.fn();
    const handler = createMediaEnrichmentWorkerHandler({
      audio: { execute: vi.fn() },
      failure: { forceFail: fail },
      images: { execute: vi.fn().mockRejectedValue(new Error("OpenAI throttled")) },
    });

    await expect(handler(sqsEvent(JSON.stringify(imageJob), "4"))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "sqs_message_test" }],
    });
    expect(fail).not.toHaveBeenCalled();
  });

  it("releases a pending message and preserves the job when retries are exhausted", async () => {
    const fail = vi.fn().mockResolvedValue("UPDATED");
    const handler = createMediaEnrichmentWorkerHandler({
      audio: { execute: vi.fn() },
      failure: { forceFail: fail },
      images: { execute: vi.fn().mockRejectedValue(new Error("OpenAI unavailable")) },
    });

    await expect(handler(sqsEvent(JSON.stringify(imageJob), "5"))).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "sqs_message_test" }],
    });
    expect(fail).toHaveBeenCalledWith(imageJob);
  });

  it("cuts off a hung final attempt early enough to release PENDING before Lambda timeout", async () => {
    vi.useFakeTimers();
    try {
      const fail = vi.fn().mockResolvedValue("UPDATED");
      const handler = createMediaEnrichmentWorkerHandler(
        {
          audio: { execute: vi.fn() },
          failure: { forceFail: fail },
          images: { execute: vi.fn().mockReturnValue(new Promise(() => undefined)) },
        },
        { attemptTimeoutMs: 100 },
      );

      const response = handler(sqsEvent(JSON.stringify(imageJob), "5"));
      await vi.advanceTimersByTimeAsync(100);

      await expect(response).resolves.toEqual({
        batchItemFailures: [{ itemIdentifier: "sqs_message_test" }],
      });
      expect(fail).toHaveBeenCalledWith(imageJob);
    } finally {
      vi.useRealTimers();
    }
  });
});
