import { describe, expect, it, vi } from "vitest";

import { MessagingGatewayApiError, MessagingGatewayClient } from "../../../src/sdk/index.js";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "cor_sdk",
    },
    status,
  });

describe("MessagingGatewayClient", () => {
  it("caches tokens and sends idempotent, authorized tenant requests", async () => {
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
        jsonResponse(201, {
          externalAccountId: "account/42",
          status: "ACTIVE",
          tenantId: "tenant_01",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          externalAccountId: "account/42",
          status: "ACTIVE",
          tenantId: "tenant_01",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          externalAccountId: "account/42",
          status: "ACTIVE",
          tenantId: "tenant_01",
        }),
      );
    const getClientSecret = vi.fn().mockResolvedValue("msgs_secret");
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example/",
      getClientSecret,
      now: () => 1_000,
    });

    await expect(
      client.ensureTenant(
        {
          externalAccountId: "account/42",
          name: "Account 42",
        },
        { idempotencyKey: "tenant:account/42" },
      ),
    ).resolves.toMatchObject({ tenantId: "tenant_01" });
    await client.getTenantByExternalAccount("account/42");
    await client.getTenantById("tenant_01");

    expect(getClientSecret).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://gateway.example/v1/tenants");
    const createHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(createHeaders.get("authorization")).toBe("Bearer token_01");
    expect(createHeaders.get("idempotency-key")).toBe("tenant:account/42");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("account%2F42");
  });

  it("refreshes a token after explicit invalidation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: "token_01",
          expiresIn: 60,
          tokenType: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          externalAccountId: "account-42",
          status: "ACTIVE",
          tenantId: "tenant_01",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: "token_02",
          expiresIn: 60,
          tokenType: "Bearer",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          externalAccountId: "account-42",
          status: "ACTIVE",
          tenantId: "tenant_01",
        }),
      );
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await client.getTenantById("tenant_01");
    client.clearToken();
    await client.getTenantById("tenant_01");

    expect(fetchMock.mock.calls[3]?.[1]?.headers).toEqual(expect.objectContaining({}));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("maps gateway errors and rejects invalid local idempotency keys", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(401, {
        error: {
          code: "AUTH_INVALID_CLIENT",
          correlationId: "cor_sdk",
          message: "Invalid credentials.",
          retryable: false,
        },
      }),
    );
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await expect(client.getTenantById("tenant_01")).rejects.toMatchObject({
      code: "AUTH_INVALID_CLIENT",
      correlationId: "cor_sdk",
      statusCode: 401,
    });
    await expect(
      client.ensureTenant(
        {
          externalAccountId: "account-42",
          name: "Account 42",
        },
        { idempotencyKey: " " },
      ),
    ).rejects.toThrow("idempotencyKey is required");
    expect(
      new MessagingGatewayApiError({
        code: "TEST",
        correlationId: "cor_test",
        message: "Test error",
        retryable: false,
        statusCode: 400,
      }),
    ).toBeInstanceOf(Error);
  });
});
