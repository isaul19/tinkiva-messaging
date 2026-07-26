import { describe, expect, it, vi } from "vitest";

import { MessagingGatewayClient } from "../../../src/sdk/index.js";

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-correlation-id": "cor_sdk_embedded",
    },
    status,
  });

describe("MessagingGatewayClient WhatsApp Embedded Signup", () => {
  it("gets browser-safe configuration and completes onboarding with the same cached JWT", async () => {
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
          appId: "1393451145991555",
          configurationId: "987654321012345",
          configured: true,
          graphApiVersion: "v25.0",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(201, {
          credentialVersion: 1,
          displayName: "Storagia customer",
          displayPhoneNumber: "+51 904 843 582",
          integrationId: "int_embedded",
          phoneNumberId: "1265721213282879",
          provider: "WHATSAPP",
          status: "ACTIVE",
          tenantId: "tenant_01",
          verifiedName: "Customer",
          webhookUrl: "https://gateway.example/webhooks/whatsapp/opaque",
        }),
      );
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example/",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    await expect(client.getWhatsappEmbeddedSignupConfiguration("tenant_01")).resolves.toMatchObject(
      {
        configured: true,
        configurationId: "987654321012345",
      },
    );
    await expect(
      client.completeWhatsappEmbeddedSignup("tenant_01", {
        authorizationCode: "one-time-authorization-code",
        businessPortfolioId: "123456789012345",
        displayName: "Storagia customer",
        phoneNumberId: "1265721213282879",
        wabaId: "1373995794700687",
      }),
    ).resolves.toMatchObject({
      integrationId: "int_embedded",
      status: "ACTIVE",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gateway.example/v1/tenants/tenant_01/integrations/whatsapp/embedded-signup/config",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://gateway.example/v1/tenants/tenant_01/integrations/whatsapp/embedded-signup",
    );
    const completionOptions = fetchMock.mock.calls[2]?.[1];
    const completionHeaders = new Headers(completionOptions?.headers);
    expect(completionHeaders.get("authorization")).toBe("Bearer token_01");
    expect(JSON.parse(completionOptions?.body as string)).toMatchObject({
      authorizationCode: "one-time-authorization-code",
      phoneNumberId: "1265721213282879",
      wabaId: "1373995794700687",
    });
  });

  it("rejects malformed tenant and completion payloads before authentication", () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new MessagingGatewayClient({
      clientId: "msgc_client",
      fetch: fetchMock,
      gatewayUrl: "https://gateway.example",
      getClientSecret: () => Promise.resolve("msgs_secret"),
    });

    expect(() => client.getWhatsappEmbeddedSignupConfiguration(" ")).toThrow();
    expect(() =>
      client.completeWhatsappEmbeddedSignup("tenant_01", {
        authorizationCode: "short",
        displayName: "Customer",
        phoneNumberId: "not-numeric",
        wabaId: "1373995794700687",
      }),
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
