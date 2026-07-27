import { describe, expect, it, vi } from "vitest";

import { MessagingGatewayClient } from "../../../src/sdk/index.js";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "cor_sdk",
    },
    status,
  });

describe("MessagingGatewayClient conversations", () => {
  it("lists WhatsApp conversations and messages with one cached access token", async () => {
    const conversation = {
      conversationId: "conv_01",
      createdAt: "2026-07-26T10:00:00.000Z",
      integrationId: "int_whatsapp",
      lastMessage: {
        conversationId: "conv_01",
        direction: "INBOUND",
        integrationId: "int_whatsapp",
        messageId: "msg_01",
        occurredAt: "2026-07-26T10:01:00.000Z",
        provider: "WHATSAPP",
        status: "RECEIVED",
        text: "Hola",
        type: "TEXT",
      },
      lastMessageAt: "2026-07-26T10:01:00.000Z",
      participant: {
        displayName: "Cliente de prueba",
        phoneNumber: "51999888777",
      },
      provider: "WHATSAPP",
      status: "OPEN",
      tenantId: "tenant_01",
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: "token_01",
          expiresIn: 900,
          tokenType: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [conversation],
          nextCursor: "next-conversation",
          tenantId: "tenant_01",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          conversationId: "conv_01",
          items: [conversation.lastMessage],
          tenantId: "tenant_01",
        }),
      );
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example/",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await expect(
      client.listConversations("tenant_01", {
        cursor: "previous-page",
        integrationId: "int_whatsapp",
        limit: 20,
      }),
    ).resolves.toEqual({
      items: [conversation],
      nextCursor: "next-conversation",
      tenantId: "tenant_01",
    });
    await expect(
      client.listConversationMessages("tenant_01", "conv_01", { limit: 50 }),
    ).resolves.toEqual({
      conversationId: "conv_01",
      items: [conversation.lastMessage],
      tenantId: "tenant_01",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gateway.example/v1/tenants/tenant_01/conversations?integrationId=int_whatsapp&limit=20&cursor=previous-page",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://gateway.example/v1/tenants/tenant_01/conversations/conv_01/messages?limit=50",
    );
    for (const call of fetchMock.mock.calls.slice(1)) {
      expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer token_01");
    }
  });
});
