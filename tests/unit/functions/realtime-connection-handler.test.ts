import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CONTROL_TABLE = "messaging-control-test";
});

import { createRealtimeConnectionHandler } from "../../../src/functions/realtime-connection/handler.js";

const websocketEvent = (routeKey: string, ticket?: string): APIGatewayProxyWebsocketEventV2 =>
  ({
    queryStringParameters: ticket === undefined ? undefined : { ticket },
    requestContext: {
      connectionId: "connection_test",
      routeKey,
    },
  }) as unknown as APIGatewayProxyWebsocketEventV2;

describe("realtime connection handler", () => {
  it("rejects missing tickets and consumes valid tickets", async () => {
    const store = {
      connect: vi.fn().mockResolvedValue({
        applicationId: "app_test",
        connectionId: "connection_test",
        expiresAt: 123,
        tenantId: "tenant_test",
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createRealtimeConnectionHandler({ store });

    await expect(handler(websocketEvent("$connect"))).resolves.toEqual({
      statusCode: 401,
    });
    expect(store.connect).not.toHaveBeenCalled();

    const ticket = `rt_${"a".repeat(43)}`;
    await expect(handler(websocketEvent("$connect", ticket))).resolves.toEqual({
      statusCode: 200,
    });
    expect(store.connect).toHaveBeenCalledTimes(1);
    const connectInput = store.connect.mock.calls[0]?.[0] as unknown;
    expect(connectInput).toHaveProperty("connectionId", "connection_test");
    expect(connectInput).toHaveProperty("ticketDigest", expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  it("removes disconnected connections and responds to heartbeat messages", async () => {
    const store = {
      connect: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createRealtimeConnectionHandler({ store });

    await expect(handler(websocketEvent("$disconnect"))).resolves.toEqual({
      statusCode: 200,
    });
    expect(store.disconnect).toHaveBeenCalledWith("connection_test");

    const response = await handler(websocketEvent("ping"));
    expect(response).toMatchObject({
      statusCode: 200,
    });
    expect(response).toHaveProperty("body");
    if (
      typeof response !== "object" ||
      !("body" in response) ||
      typeof response.body !== "string"
    ) {
      throw new Error("Expected a structured WebSocket response body");
    }
    expect(response.body).toContain('"type":"pong"');
  });
});
