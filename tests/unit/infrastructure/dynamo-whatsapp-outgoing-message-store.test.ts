import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { DynamoWhatsappOutgoingMessageStore } from "../../../src/infrastructure/dynamodb/dynamo-whatsapp-outgoing-message-store.js";

describe("DynamoWhatsappOutgoingMessageStore", () => {
  it("keeps BSUID as the identity but uses the verified phone alias for delivery", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          applicationId: "app_demo",
          provider: "WHATSAPP",
          status: "ACTIVE",
          tenantId: "tenant_demo",
        },
      })
      .mockResolvedValueOnce({
        Item: {
          identityId: "identity_demo",
          integrationId: "int_demo",
          tenantId: "tenant_demo",
        },
      })
      .mockResolvedValueOnce({
        Item: {
          canonicalType: "WHATSAPP_BSUID",
          canonicalValue: "business-scoped-user-id",
          phoneE164: "+51900111222",
        },
      });
    const store = new DynamoWhatsappOutgoingMessageStore(
      { send } as unknown as DynamoDBDocumentClient,
      "control-table",
      "data-table",
    );

    await expect(
      store.resolveWhatsappDestination({
        applicationId: "app_demo",
        conversationId: "conv_demo",
        integrationId: "int_demo",
        tenantId: "tenant_demo",
      }),
    ).resolves.toEqual({
      conversationId: "conv_demo",
      createDestinationRecords: false,
      recipientId: "51900111222",
      recipientType: "WHATSAPP_PHONE",
    });
  });
});
