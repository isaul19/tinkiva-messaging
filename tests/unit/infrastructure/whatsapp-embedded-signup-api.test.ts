import { describe, expect, it, vi } from "vitest";

import { WhatsappManagementApiClient } from "../../../src/infrastructure/whatsapp/whatsapp-management-api-client.js";

describe("WhatsappManagementApiClient Embedded Signup", () => {
  it("exchanges a one-time authorization code without exposing the App Secret", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "business-integration-system-user-token",
          expires_in: 5_184_000,
          token_type: "bearer",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.exchangeAuthorizationCode({
        appId: "1393451145991555",
        appSecret: "meta-platform-app-secret-for-tests",
        authorizationCode: "one-time-authorization-code",
        graphApiVersion: "v25.0",
      }),
    ).resolves.toEqual({
      accessToken: "business-integration-system-user-token",
      expiresIn: 5_184_000,
      tokenType: "bearer",
    });
    const call = fetchImplementation.mock.calls[0] as unknown as [URL, RequestInit];
    expect(call[0].pathname).toBe("/v25.0/oauth/access_token");
    expect(call[0].searchParams.get("client_id")).toBe("1393451145991555");
    expect(call[0].searchParams.get("client_secret")).toBe("meta-platform-app-secret-for-tests");
    expect(call[0].searchParams.get("code")).toBe("one-time-authorization-code");
  });

  it("maps an invalid or consumed authorization code to a public credential error", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 100 } }), {
        headers: { "content-type": "application/json" },
        status: 400,
      }),
    );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.exchangeAuthorizationCode({
        appId: "1393451145991555",
        appSecret: "meta-platform-app-secret-for-tests",
        authorizationCode: "consumed-authorization-code",
        graphApiVersion: "v25.0",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_INVALID",
      statusCode: 400,
    });
  });
});
