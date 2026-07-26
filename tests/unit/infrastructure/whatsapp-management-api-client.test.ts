import { describe, expect, it, vi } from "vitest";

import { WhatsappManagementApiClient } from "../../../src/infrastructure/whatsapp/whatsapp-management-api-client.js";

describe("WhatsappManagementApiClient", () => {
  it("does not accept an HTTP 200 subscription response with success false", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.subscribeWaba({
        accessToken: "t".repeat(32),
        callbackUrl: "https://messaging.example/webhooks/whatsapp/key",
        graphApiVersion: "v25.0",
        verifyToken: "v".repeat(43),
        wabaId: "991122",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CONFIGURATION_INVALID",
      retryable: false,
      statusCode: 400,
    });
  });

  it("subscribes the app before applying the tenant callback override", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                override_callback_uri: "https://messaging.example/webhooks/whatsapp/key",
              },
            ],
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.subscribeWaba({
        accessToken: "t".repeat(32),
        callbackUrl: "https://messaging.example/webhooks/whatsapp/key",
        graphApiVersion: "v25.0",
        verifyToken: "v".repeat(43),
        wabaId: "991122",
      }),
    ).resolves.toBeUndefined();

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://graph.facebook.com/v25.0/991122/subscribed_apps",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://graph.facebook.com/v25.0/991122/subscribed_apps",
      expect.objectContaining({
        body: JSON.stringify({
          override_callback_uri: "https://messaging.example/webhooks/whatsapp/key",
          verify_token: "v".repeat(43),
        }),
        method: "POST",
      }),
    );
  });

  it("maps WABA phone metadata without exposing the access token", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              display_phone_number: "+57 300 000 0000",
              id: "778899",
              quality_rating: "GREEN",
              verified_name: "Tinkiva",
            },
          ],
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const client = new WhatsappManagementApiClient(fetchImplementation);

    await expect(
      client.getPhoneNumbers({
        accessToken: "t".repeat(32),
        graphApiVersion: "v25.0",
        wabaId: "991122",
      }),
    ).resolves.toEqual([
      {
        displayPhoneNumber: "+57 300 000 0000",
        id: "778899",
        qualityRating: "GREEN",
        verifiedName: "Tinkiva",
      },
    ]);
  });
});
