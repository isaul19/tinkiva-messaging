import { describe, expect, it, vi } from "vitest";

import { MessagingGatewayClient } from "../../../src/sdk/index.js";

describe("MessagingGatewayClient invalid responses", () => {
  it("rejects non-JSON gateway responses with a safe retryable error", async () => {
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("<html>upstream failure</html>", {
          headers: {
            "x-correlation-id": "cor_invalid_json",
          },
          status: 502,
        }),
      ),
      gatewayUrl: "https://gateway.example",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await expect(client.getTenantById("tenant_01")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      correlationId: "cor_invalid_json",
      retryable: true,
      statusCode: 502,
    });
  });
});
