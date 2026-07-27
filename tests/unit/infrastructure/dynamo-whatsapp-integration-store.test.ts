import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoWhatsappIntegrationStore } from "../../../src/infrastructure/dynamodb/dynamo-whatsapp-integration-store.js";

describe("DynamoWhatsappIntegrationStore", () => {
  it("deletes every pending record with ownership conditions so registration can retry", async () => {
    const commands: unknown[] = [];
    const send = vi.fn((command: unknown) => {
      commands.push(command);
      return Promise.resolve({});
    });
    const store = new DynamoWhatsappIntegrationStore(
      { send } as unknown as DynamoDBDocumentClient,
      "messaging-control-test",
    );

    await store.deletePending({
      integrationId: "int_test",
      phoneNumberId: "phone_test",
      providerConnectionId: "pc_test",
      tenantId: "tenant_test",
      wabaId: "waba_test",
      webhookKey: "webhook_test",
    });

    expect(send).toHaveBeenCalledTimes(1);
    const command = commands[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand)) {
      throw new Error("Expected a TransactWriteCommand.");
    }

    const deletes = command.input.TransactItems?.map((item) => item.Delete);
    expect(deletes).toHaveLength(6);
    expect(deletes?.map((item) => item?.Key)).toEqual([
      { PK: "PROVIDER_CONNECTION#pc_test", SK: "META" },
      { PK: "INTEGRATION#int_test", SK: "META" },
      {
        PK: "TENANT#tenant_test",
        SK: "INTEGRATION#WHATSAPP#int_test",
      },
      { PK: "WEBHOOK#WHATSAPP#webhook_test", SK: "REF" },
      { PK: "WHATSAPP_WABA#waba_test", SK: "REF" },
      { PK: "WHATSAPP_PHONE_NUMBER#phone_test", SK: "REF" },
    ]);
    expect(
      deletes?.every(
        (item) =>
          item?.TableName === "messaging-control-test" &&
          item.ConditionExpression?.endsWith(" = :expectedValue") === true,
      ),
    ).toBe(true);
  });
});
