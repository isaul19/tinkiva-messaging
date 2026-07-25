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

describe("MessagingGatewayClient.sendMessage", () => {
  it("sends an authenticated and idempotent Telegram text command", async () => {
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
        jsonResponse(202, {
          idempotencyKey: "order:123",
          messageId: "msg_01",
          status: "QUEUED",
        }),
      );
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });
    const request = {
      content: {
        text: { body: "Pedido confirmado" },
        type: "TEXT" as const,
      },
      integrationId: "int_telegram",
      recipient: {
        type: "TELEGRAM_CHAT_ID" as const,
        value: "123456",
      },
      tenantId: "tenant_01",
    };

    await expect(client.sendMessage(request, { idempotencyKey: "order:123" })).resolves.toEqual({
      idempotencyKey: "order:123",
      messageId: "msg_01",
      status: "QUEUED",
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://gateway.example/v1/messages");
    const options = fetchMock.mock.calls[1]?.[1];
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer token_01");
    expect(headers.get("idempotency-key")).toBe("order:123");
    expect(typeof options?.body).toBe("string");
    expect(JSON.parse(options?.body as string)).toEqual(request);
  });

  it("rejects a blank idempotency key before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await expect(
      client.sendMessage(
        {
          content: {
            text: { body: "Hola" },
            type: "TEXT",
          },
          integrationId: "int_telegram",
          recipient: {
            type: "TELEGRAM_CHAT_ID",
            value: "123456",
          },
          tenantId: "tenant_01",
        },
        { idempotencyKey: " " },
      ),
    ).rejects.toThrow("idempotencyKey is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
