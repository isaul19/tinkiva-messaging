import { createHash } from "node:crypto";

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

        expect(writes).toEqual(
          expect.arrayContaining([
            {
              DeleteRequest: {
                Key: {
                  PK: "CONVERSATION#conv_test",
                  SK: "MESSAGE#2026-07-28T12:00:00.000Z#msg_test",
                },
              },
            },
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
    );

    await expect(store.deleteConversation(input)).resolves.toBeUndefined();
    expect(queryCount).toBe(2);
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
