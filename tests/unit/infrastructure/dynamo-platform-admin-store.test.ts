import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoPlatformAdminStore } from "../../../src/infrastructure/dynamodb/dynamo-platform-admin-store.js";

const integration = {
  PK: "INTEGRATION#int_test",
  SK: "META",
  applicationId: "app_test",
  botId: "bot_test",
  createdAt: "2026-08-12T10:00:00.000Z",
  displayName: "Support bot",
  entityType: "CHANNEL_INTEGRATION",
  integrationId: "int_test",
  provider: "TELEGRAM",
  providerAccountId: "bot_test",
  providerConnectionId: "pc_test",
  status: "ACTIVE",
  tenantId: "tenant_test",
} as const;

const tenantLink = {
  applicationId: integration.applicationId,
  externalAccountId: "account_test",
  status: "ACTIVE",
  tenantId: integration.tenantId,
} as const;

describe("DynamoPlatformAdminStore", () => {
  it("lists integration metadata with exact chat counts and disabled enrichment defaults", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof ScanCommand) {
        expect(command.input).toMatchObject({
          ConsistentRead: true,
          FilterExpression: "entityType = :entityType",
          Limit: 250,
          TableName: "control-test",
        });
        return Promise.resolve({ Items: [integration] });
      }
      if (command instanceof QueryCommand) {
        if (command.input.Select !== "COUNT") return Promise.resolve({ Items: [tenantLink] });
        expect(command.input).toMatchObject({
          IndexName: "GSI1",
          Select: "COUNT",
          ExpressionAttributeValues: {
            ":partitionKey":
              "APPLICATION#app_test#TENANT#tenant_test#INTEGRATION#int_test#CONVERSATIONS",
          },
        });
        return Promise.resolve({ Count: 7 });
      }
      if (command instanceof BatchGetCommand) return Promise.resolve({ Responses: {} });
      throw new Error("Unexpected command.");
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(store.listIntegrations({})).resolves.toEqual({
      items: [
        {
          applicationId: "app_test",
          chatCount: 7,
          createdAt: "2026-08-12T10:00:00.000Z",
          displayName: "Support bot",
          inboundMedia: { audioAlternativeText: false, imageAlternativeText: false },
          integrationId: "int_test",
          openAiCredential: { configured: false },
          provider: "TELEGRAM",
          providerAccountId: "bot_test",
          status: "ACTIVE",
          tenantId: "tenant_test",
        },
      ],
    });
  });

  it("lists only non-sensitive OpenAI credential status metadata", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof ScanCommand) {
        return Promise.resolve({
          Items: [
            {
              ...integration,
              apiKey: "sk-must-never-leak",
              credentialCiphertext: "ciphertext-must-never-leak",
              openAiCredential: {
                configured: true,
                credentialVersion: 4,
                updatedAt: "2026-08-12T12:00:00.000Z",
              },
            },
          ],
        });
      }
      if (command instanceof QueryCommand) {
        return command.input.Select === "COUNT"
          ? Promise.resolve({ Count: 0 })
          : Promise.resolve({ Items: [tenantLink] });
      }
      if (command instanceof BatchGetCommand) {
        return Promise.resolve({
          Responses: {
            "control-test": [
              {
                credentialStatus: "VALID",
                enabled: true,
                provider: "OPENAI",
                tenantId: "account_test",
                updatedAt: "2026-08-12T12:00:00.000Z",
              },
            ],
          },
        });
      }
      throw new Error("Unexpected command.");
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    const result = await store.listIntegrations({});

    expect(result.items[0]?.openAiCredential).toEqual({
      configured: true,
      credentialVersion: 1,
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("sk-must-never-leak");
    expect(JSON.stringify(result)).not.toContain("ciphertext-must-never-leak");
  });

  it("disables inbound media without requiring a credential", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> => {
      void command;
      return Promise.resolve({});
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    const result = await store.updateInboundMedia({
      applicationId: "app_test",
      inboundMedia: { audioAlternativeText: false, imageAlternativeText: false },
      integrationId: "int_test",
      tenantId: "tenant_test",
    });

    expect(result.inboundMedia).toEqual({
      audioAlternativeText: false,
      imageAlternativeText: false,
    });
    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(UpdateCommand);
    if (!(command instanceof UpdateCommand)) throw new Error("Expected UpdateCommand.");
    expect(command.input).toMatchObject({
      ConditionExpression:
        "applicationId = :applicationId AND tenantId = :tenantId " +
        "AND integrationId = :integrationId AND entityType = :entityType",
      Key: { PK: "INTEGRATION#int_test", SK: "META" },
      UpdateExpression: "SET inboundMedia = :inboundMedia, updatedAt = :updatedAt",
    });
  });

  it("verifies the tenant OpenAI credential before enabling inbound media", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof QueryCommand) return Promise.resolve({ Items: [tenantLink] });
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            credentialStatus: "VALID",
            enabled: true,
            provider: "OPENAI",
            tenantId: "account_test",
            updatedAt: "2026-08-12T12:00:00.000Z",
          },
        });
      }
      if (command instanceof UpdateCommand) return Promise.resolve({});
      throw new Error("Unexpected command.");
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await store.updateInboundMedia({
      applicationId: "app_test",
      inboundMedia: { audioAlternativeText: true, imageAlternativeText: false },
      integrationId: "int_test",
      tenantId: "tenant_test",
    });

    const credentialRead = send.mock.calls[1]?.[0];
    expect(credentialRead).toBeInstanceOf(GetCommand);
    if (!(credentialRead instanceof GetCommand)) throw new Error("Expected credential read.");
    expect(credentialRead.input).toMatchObject({
      Key: { PK: "TENANT#account_test", SK: "PROVIDER#OPENAI" },
      TableName: "control-test",
    });
    const integrationUpdate = send.mock.calls[2]?.[0];
    expect(integrationUpdate).toBeInstanceOf(UpdateCommand);
    if (!(integrationUpdate instanceof UpdateCommand)) throw new Error("Expected update.");
    expect(integrationUpdate.input).toMatchObject({
      Key: { PK: "INTEGRATION#int_test", SK: "META" },
      UpdateExpression: "SET inboundMedia = :inboundMedia, updatedAt = :updatedAt",
    });
  });

  it("rejects enabling inbound media when the integration has no OpenAI credential", async () => {
    const send = vi.fn((command: unknown): Promise<unknown> =>
      command instanceof QueryCommand
        ? Promise.resolve({ Items: [tenantLink] })
        : Promise.resolve({}),
    );
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(
      store.updateInboundMedia({
        applicationId: "app_test",
        inboundMedia: { audioAlternativeText: false, imageAlternativeText: true },
        integrationId: "int_test",
        tenantId: "tenant_test",
      }),
    ).rejects.toMatchObject({ code: "OPENAI_CREDENTIAL_REQUIRED", statusCode: 409 });
  });

  it("requires a consistent empty verification pass after deleting a short GSI page", async () => {
    let gsiQueries = 0;
    const conversation = {
      PK: "CONVERSATION#conv_test",
      SK: "META",
      applicationId: "app_test",
      conversationId: "conv_test",
      integrationId: "int_test",
      lastMessageAt: "2026-08-12T10:00:00.000Z",
      tenantId: "tenant_test",
    };
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof GetCommand) {
        return Promise.resolve(
          command.input.Key?.PK === "INTEGRATION#int_test"
            ? { Item: integration }
            : { Item: conversation },
        );
      }
      if (command instanceof QueryCommand && command.input.IndexName === "GSI1") {
        gsiQueries += 1;
        return Promise.resolve({ Items: gsiQueries === 1 ? [conversation] : [] });
      }
      if (command instanceof QueryCommand) return Promise.resolve({ Items: [] });
      if (command instanceof DeleteCommand) return Promise.resolve({});
      if (command instanceof ScanCommand) {
        expect(command.input.ConsistentRead).toBe(true);
        return Promise.resolve({ Items: [] });
      }
      throw new Error("Unexpected command.");
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );
    const request = {
      applicationId: "app_test",
      integrationId: "int_test",
      mode: "CHATS_ONLY" as const,
      tenantId: "tenant_test",
    };

    await expect(store.deleteIntegrationData(request)).resolves.toMatchObject({
      deletedChats: 1,
      status: "IN_PROGRESS",
    });
    await expect(store.deleteIntegrationData(request)).resolves.toMatchObject({
      deletedChats: 0,
      status: "COMPLETED",
    });
  });

  it("keeps an administrative purge in progress while a chat has another message page", async () => {
    const conversation = {
      PK: "CONVERSATION#conv_test",
      SK: "META",
      applicationId: "app_test",
      conversationId: "conv_test",
      integrationId: "int_test",
      lastMessageAt: "2026-08-12T10:00:00.000Z",
      tenantId: "tenant_test",
    };
    const send = vi.fn((command: unknown): Promise<unknown> => {
      if (command instanceof GetCommand) {
        return Promise.resolve(
          command.input.Key?.PK === "INTEGRATION#int_test"
            ? { Item: integration }
            : { Item: conversation },
        );
      }
      if (command instanceof QueryCommand && command.input.IndexName === "GSI1") {
        return Promise.resolve({ Items: [conversation] });
      }
      if (command instanceof QueryCommand) {
        return Promise.resolve({
          Items: [
            {
              PK: "CONVERSATION#conv_test",
              SK: "MESSAGE#2026-08-12T10:00:00.000Z#msg_test",
              applicationId: "app_test",
              conversationId: "conv_test",
              integrationId: "int_test",
              messageId: "msg_test",
              provider: "TELEGRAM",
              tenantId: "tenant_test",
            },
          ],
          LastEvaluatedKey: {
            PK: "CONVERSATION#conv_test",
            SK: "MESSAGE#2026-08-12T10:00:00.000Z#msg_test",
          },
        });
      }
      if (command instanceof BatchWriteCommand) return Promise.resolve({});
      throw new Error("Unexpected command.");
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(
      store.deleteIntegrationData({
        applicationId: "app_test",
        integrationId: "int_test",
        mode: "CHATS_ONLY",
        tenantId: "tenant_test",
      }),
    ).resolves.toEqual({
      deletedChats: 0,
      integrationId: "int_test",
      mode: "CHATS_ONLY",
      status: "IN_PROGRESS",
    });
    expect(send.mock.calls.some(([command]) => command instanceof DeleteCommand)).toBe(false);
  });

  it("disables ingress, deletes every discoverable registration reference, then deletes metadata last", async () => {
    const commands: unknown[] = [];
    let getCount = 0;
    let queryCount = 0;
    const send = vi.fn((command: unknown): Promise<unknown> => {
      commands.push(command);
      if (command instanceof GetCommand) {
        getCount += 1;
        return Promise.resolve(
          getCount === 1
            ? { Item: integration }
            : {
                Item: {
                  PK: "PROVIDER_CONNECTION#pc_test",
                  SK: "META",
                  applicationId: "app_test",
                  provider: "TELEGRAM",
                  providerConnectionId: "pc_test",
                  tenantId: "tenant_test",
                  webhookKey: "webhook_test",
                },
              },
        );
      }
      if (command instanceof QueryCommand) {
        queryCount += 1;
        return Promise.resolve(
          queryCount === 1
            ? { Items: [] }
            : {
                Items: [
                  { PK: "INTEGRATION#int_test", SK: "META" },
                  {
                    PK: "INTEGRATION#int_test",
                    SK: "IDENTITY_KEY#TELEGRAM_CHAT_ID#hash",
                    identityId: "identity_test",
                  },
                  {
                    PK: "INTEGRATION#int_test",
                    SK: "CONVERSATION_BY_IDENTITY#identity_test",
                  },
                ],
              },
        );
      }
      return Promise.resolve({});
    });
    const store = new DynamoPlatformAdminStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-test",
      "data-test",
    );

    await expect(
      store.deleteIntegrationData({
        applicationId: "app_test",
        integrationId: "int_test",
        mode: "INTEGRATION_AND_CHATS",
        tenantId: "tenant_test",
      }),
    ).resolves.toEqual({
      deletedChats: 0,
      integrationId: "int_test",
      mode: "INTEGRATION_AND_CHATS",
      status: "COMPLETED",
    });

    const transactions = commands.filter(
      (command): command is TransactWriteCommand => command instanceof TransactWriteCommand,
    );
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.input.TransactItems?.map((item) => item.Update?.Key)).toEqual([
      { PK: "INTEGRATION#int_test", SK: "META" },
      { PK: "PROVIDER_CONNECTION#pc_test", SK: "META" },
      { PK: "TENANT#tenant_test", SK: "INTEGRATION#TELEGRAM#int_test" },
      { PK: "WEBHOOK#TELEGRAM#webhook_test", SK: "REF" },
    ]);
    expect(transactions[1]?.input.TransactItems?.map((item) => item.Delete?.Key)).toEqual([
      { PK: "INTEGRATION#int_test", SK: "META" },
      { PK: "PROVIDER_CONNECTION#pc_test", SK: "META" },
      { PK: "INTEGRATION#int_test", SK: "OPENAI_CREDENTIAL" },
    ]);
    const batchWrites = commands
      .filter((command): command is BatchWriteCommand => command instanceof BatchWriteCommand)
      .flatMap((command) => command.input.RequestItems?.["control-test"] ?? []);
    expect(batchWrites).toEqual(
      expect.arrayContaining([
        { DeleteRequest: { Key: { PK: "IDENTITY#identity_test", SK: "META" } } },
        { DeleteRequest: { Key: { PK: "TELEGRAM_BOT#bot_test", SK: "REF" } } },
        {
          DeleteRequest: {
            Key: { PK: "PROVIDER_CONNECTION#pc_test", SK: "CREDENTIAL" },
          },
        },
      ]),
    );
  });
});
