import { describe, expect, it, vi } from "vitest";

import { MessagingGatewayClient } from "../../../src/sdk/index.js";

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "cor_realtime",
    },
    status: 200,
  });

describe("MessagingGatewayClient realtime", () => {
  it("creates a tenant-scoped realtime ticket without exposing client credentials", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          accessToken: "token_01",
          expiresIn: 900,
          tokenType: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          expiresAt: "2026-07-26T22:01:00.000Z",
          ticket: `rt_${"a".repeat(43)}`,
          websocketUrl: "wss://realtime.example/dev",
        }),
      );
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example/",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await expect(client.createRealtimeTicket("tenant_01")).resolves.toEqual({
      expiresAt: "2026-07-26T22:01:00.000Z",
      ticket: `rt_${"a".repeat(43)}`,
      websocketUrl: "wss://realtime.example/dev",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gateway.example/v1/tenants/tenant_01/realtime/tickets",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe(
      "Bearer token_01",
    );
  });
});
