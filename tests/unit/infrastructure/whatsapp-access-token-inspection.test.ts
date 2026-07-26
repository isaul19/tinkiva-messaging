import { describe, expect, it, vi } from "vitest";

import { WhatsappManagementApiClient } from "../../../src/infrastructure/whatsapp/whatsapp-management-api-client.js";

describe("WhatsappManagementApiClient access token inspection", () => {
  it("inspects token ownership, scopes, type, and expiration without returning secrets", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            app_id: "1393451145991555",
            data_access_expires_at: 1_800_000_000,
            expires_at: 1_799_000_000,
            is_valid: true,
            scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
            type: "USER",
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.inspectAccessToken({
        accessToken: "new-whatsapp-access-token-for-tests",
        appId: "1393451145991555",
        appSecret: "meta-app-secret-for-tests",
        graphApiVersion: "v25.0",
      }),
    ).resolves.toEqual({
      appId: "1393451145991555",
      dataAccessExpiresAt: 1_800_000_000,
      expiresAt: 1_799_000_000,
      isValid: true,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      type: "USER",
    });
    const call = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(call[0].pathname).toBe("/v25.0/debug_token");
    expect(call[0].searchParams.get("input_token")).toBe("new-whatsapp-access-token-for-tests");
    expect(call[1]).toMatchObject({
      headers: {
        authorization: "Bearer 1393451145991555|meta-app-secret-for-tests",
      },
      method: "GET",
    });
  });

  it("rejects an invalid token even when Meta responds with HTTP 200", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            app_id: "1393451145991555",
            is_valid: false,
            scopes: [],
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.inspectAccessToken({
        accessToken: "invalid-whatsapp-access-token",
        appId: "1393451145991555",
        appSecret: "meta-app-secret-for-tests",
        graphApiVersion: "v25.0",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_INVALID",
      statusCode: 400,
    });
  });
});
