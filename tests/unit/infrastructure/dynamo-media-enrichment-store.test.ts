import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoMediaEnrichmentStore } from "../../../src/infrastructure/dynamodb/dynamo-media-enrichment-store.js";

const job = {
  applicationId: "app_test",
  conversationId: "conv_test",
  integrationId: "int_test",
  media: {
    bucket: "media-test",
    key: "tenants/tenant_test/image.jpg",
    mimeType: "image/jpeg" as const,
    sha256: "a".repeat(64),
    sizeBytes: 3,
  },
  messageId: "msg_test",
  messageSortKey: "MESSAGE#2026-08-12T12:00:00.000Z#msg_test",
  tenantId: "tenant_test",
  type: "IMAGE" as const,
};

describe("DynamoMediaEnrichmentStore", () => {
  it("validates a pending inbound job before any external generation", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoMediaEnrichmentStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    const claim = await store.claim(job);
    expect(claim).not.toBe("IGNORED");
    if (claim === "IGNORED") throw new Error("Expected the enrichment claim to succeed.");
    expect(claim.leaseId.length).toBeGreaterThan(0);
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(
      (command as TransactWriteCommand).input.TransactItems?.[2]?.Update?.UpdateExpression,
    ).toBe("SET #leaseId = :leaseId, #leaseExpiresAt = :leaseExpiresAt");
    expect(
      (command as TransactWriteCommand).input.TransactItems?.[2]?.Update?.ExpressionAttributeValues,
    ).toEqual(
      expect.objectContaining({
        ":mediaBucket": job.media.bucket,
        ":mediaKey": job.media.key,
        ":mediaMimeType": job.media.mimeType,
        ":mediaSha256": job.media.sha256,
        ":mediaSizeBytes": job.media.sizeBytes,
      }),
    );
    expect(
      (command as TransactWriteCommand).input.TransactItems?.[0]?.ConditionCheck
        ?.ConditionExpression,
    ).toContain("#inboundMedia.#flag = :enabled");
    expect((command as TransactWriteCommand).input.TransactItems?.[1]?.ConditionCheck?.Key).toEqual(
      {
        PK: "INTEGRATION#int_test",
        SK: "OPENAI_CREDENTIAL",
      },
    );
  });

  it("ignores a claim rejected by message or integration conditions", async () => {
    const send = vi.fn().mockRejectedValue(
      new TransactionCanceledException({
        $metadata: {},
        CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
        message: "inactive",
      }),
    );
    const store = new DynamoMediaEnrichmentStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.claim(job)).resolves.toBe("IGNORED");
  });

  it("atomically completes only the matching pending inbound message", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoMediaEnrichmentStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(
      store.complete({ alternativeText: " Una imagen ", claim: { leaseId: "lease_test" }, job }),
    ).resolves.toBe("UPDATED");
    const command: unknown = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    const input = (command as UpdateCommand).input;
    expect(input.ExpressionAttributeValues).toEqual(
      expect.objectContaining({
        ":direction": "INBOUND",
        ":leaseId": "lease_test",
        ":metadata": { alternativeText: "Una imagen", alternativeTextStatus: "READY" },
        ":pending": "PENDING",
      }),
    );
    expect(input.ConditionExpression).toContain("#leaseId = :leaseId");
  });

  it("ignores a stale or already-completed job", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(new ConditionalCheckFailedException({ $metadata: {}, message: "stale" }));
    const store = new DynamoMediaEnrichmentStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.forceFail(job)).resolves.toBe("IGNORED");
  });
});
