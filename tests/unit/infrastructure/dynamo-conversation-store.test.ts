import { createHash } from "node:crypto";

import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { BatchWriteCommand, DeleteCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoConversationStore } from "../../../src/infrastructure/dynamodb/dynamo-conversation-store.js";

const input = {
  applicationId: "app_test",
  conversationId: "conv_test",
  tenantId: "tenant_test",
};

describe("DynamoConversationStore", () => {
  it("deletes the conversation, its messages, and local message references", async () => {
    let queryCount = 0;
    const deleteMedia = vi.fn().mockResolvedValue(undefined);
    const media = {
      bucket: "media-test",
      key: "tenants/tenant_test/whatsapp/message.ogg",
      mimeType: "audio/ogg",
      sha256: "a".repeat(64),
      sizeBytes: 128,
    };
    const send = vi.fn(async (command: unknown): Promise<unknown> => {
      await Promise.resolve();

      if (command instanceof GetCommand) {
        expect(command.input.ConsistentRead).toBe(true);
        return {
          Item: {
            ...input,
            lastMessageAt: "2026-07-28T12:00:00.000Z",
          },
        };
      }

      if (command instanceof QueryCommand) {
        queryCount += 1;
        expect(command.input.ConsistentRead).toBe(true);
        expect(command.input.Limit).toBe(25);
        expect(command.input.ExpressionAttributeValues).toEqual({
          ":messagePrefix": "MESSAGE#",
          ":partitionKey": "CONVERSATION#conv_test",
        });

        return queryCount === 1
          ? {
              Items: [
                {
                  PK: "CONVERSATION#conv_test",
                  SK: "MESSAGE#2026-07-28T12:00:00.000Z#msg_test",
                  ...input,
                  integrationId: "int_test",
                  media,
                  messageId: "msg_test",
                  provider: "WHATSAPP",
                  providerMessageId: "wamid.test",
                },
              ],
            }
          : { Items: [] };
      }

      if (command instanceof BatchWriteCommand) {
        const writes = command.input.RequestItems?.["data-test"];
        const providerMessageHash = createHash("sha256").update("wamid.test", "utf8").digest("hex");

        if (
          writes?.some((write) => write.DeleteRequest?.Key?.PK === "CONVERSATION#conv_test") ===
          true
        ) {
          expect(writes).toEqual([
            {
              DeleteRequest: {
                Key: {
                  PK: "CONVERSATION#conv_test",
                  SK: "MESSAGE#2026-07-28T12:00:00.000Z#msg_test",
                },
              },
            },
          ]);
        } else {
          expect(writes).toEqual(
            expect.arrayContaining([
              {
                DeleteRequest: {
                  Key: {
                    PK: "MESSAGE#msg_test",
                    SK: "REF",
                  },
                },
              },
              {
                DeleteRequest: {
                  Key: {
                    PK: `PROVIDER_MESSAGE#WHATSAPP#int_test#${providerMessageHash}`,
                    SK: "REF",
                  },
                },
              },
            ]),
          );
        }
        return {};
      }

      if (command instanceof DeleteCommand) {
        expect(command.input).toMatchObject({
          ConditionExpression:
            "applicationId = :applicationId AND tenantId = :tenantId " +
            "AND lastMessageAt = :lastMessageAt",
          ExpressionAttributeValues: {
            ":applicationId": "app_test",
            ":lastMessageAt": "2026-07-28T12:00:00.000Z",
            ":tenantId": "tenant_test",
          },
          Key: {
            PK: "CONVERSATION#conv_test",
            SK: "META",
          },
          TableName: "control-test",
        });
        return {};
      }

      throw new Error("Unexpected DynamoDB command.");
    });
    const store = new DynamoConversationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
      { deleteMedia },
    );

    await expect(store.deleteConversation(input)).resolves.toBeUndefined();
    expect(queryCount).toBe(1);
    expect(deleteMedia).toHaveBeenCalledWith({
      applicationId: "app_test",
      media: [media],
      tenantId: "tenant_test",
    });
  });

  it("bounds administrative deletion to one resumable message page", async () => {
    let queryCount = 0;
    const writeOrder: string[] = [];
    const message = (index: number) => ({
      PK: "CONVERSATION#conv_test",
      SK: `MESSAGE#2026-07-28T12:00:00.000Z#msg_${String(index)}`,
      ...input,
      integrationId: "int_test",
      messageId: `msg_${String(index)}`,
      provider: "TELEGRAM",
    });
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: { ...input, lastMessageAt: "2026-07-28T12:00:00.000Z" },
        });
      }
      if (command instanceof QueryCommand) {
        queryCount += 1;
        expect(command.input.Limit).toBe(25);
        return Promise.resolve(
          queryCount === 1
            ? {
                Items: Array.from({ length: 25 }, (_, index) => message(index)),
                LastEvaluatedKey: {
                  PK: "CONVERSATION#conv_test",
                  SK: "MESSAGE#2026-07-28T12:00:00.000Z#msg_24",
                },
              }
            : { Items: [message(25)] },
        );
      }
      if (command instanceof BatchWriteCommand) {
        const writes = command.input.RequestItems?.["data-test"] ?? [];
        expect(writes.length).toBeLessThanOrEqual(25);
        writeOrder.push(
          writes.every((write) => write.DeleteRequest?.Key?.SK === "REF")
            ? "references"
            : "messages",
        );
        return Promise.resolve({});
      }
      if (command instanceof DeleteCommand) return Promise.resolve({});
      throw new Error("Unexpected DynamoDB command.");
    });
    const store = new DynamoConversationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.deleteConversationPage(input)).resolves.toBe("IN_PROGRESS");
    expect(send.mock.calls.some(([command]) => command instanceof DeleteCommand)).toBe(false);
    await expect(store.deleteConversationPage(input)).resolves.toBe("COMPLETED");

    expect(queryCount).toBe(2);
    expect(writeOrder).toEqual(["references", "messages", "references", "messages"]);
    expect(send.mock.calls.filter(([command]) => command instanceof DeleteCommand)).toHaveLength(1);
  });

  it("leaves an administrative deletion resumable when the conversation changes", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: { ...input, lastMessageAt: "2026-07-28T12:00:00.000Z" },
        });
      }
      if (command instanceof QueryCommand) return Promise.resolve({ Items: [] });
      if (command instanceof DeleteCommand) {
        return Promise.reject(
          new ConditionalCheckFailedException({ message: "changed", $metadata: {} }),
        );
      }
      throw new Error("Unexpected DynamoDB command.");
    });
    const store = new DynamoConversationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.deleteConversationPage(input)).resolves.toBe("IN_PROGRESS");
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("is idempotent when the conversation no longer exists", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoConversationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.deleteConversation(input)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetCommand);
  });

  it("does not delete a conversation owned by another tenant", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        applicationId: input.applicationId,
        conversationId: input.conversationId,
        lastMessageAt: "2026-07-28T12:00:00.000Z",
        tenantId: "tenant_other",
      },
    });
    const store = new DynamoConversationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.deleteConversation(input)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
      statusCode: 404,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
