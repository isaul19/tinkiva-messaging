import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
  Callback,
  Context,
} from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { main } from "../../../src/functions/health/handler.js";

describe("health handler", () => {
  it("returns only liveness information", async () => {
    const event = {
      headers: {
        "x-correlation-id": "cor_health_01",
      },
    } as unknown as APIGatewayProxyEventV2;

    const result = await main(event, {} as Context, vi.fn() as Callback<APIGatewayProxyResultV2>);

    expect(result).toMatchObject({
      body: JSON.stringify({
        service: "tinkiva-messaging-gateway",
        status: "ok",
      }),
      statusCode: 200,
    });
  });
});
