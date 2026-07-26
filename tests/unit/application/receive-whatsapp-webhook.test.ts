import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ReceiveWhatsappWebhook } from "../../../src/application/whatsapp/receive-whatsapp-webhook.js";
import { whatsappWebhookPayloadSchema } from "../../../src/contracts/providers/whatsapp.contract.js";

const appSecret = "a".repeat(32);
const verifyToken = "v".repeat(43);
const webhookConnection = {
  applicationId: "app_test",
  credentialRef: "pc_test",
  providerConnectionId: "pc_test",
  status: "ACTIVE" as const,
  tenantId: "tenant_test",
};
const phoneIntegration = {
  applicationId: "app_test",
  integrationId: "int_test",
  providerConnectionId: "pc_test",
  status: "ACTIVE" as const,
  tenantId: "tenant_test",
};

const payload = whatsappWebhookPayloadSchema.parse({
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            contacts: [
              {
                profile: { name: "Saul" },
                user_id: "bsuid_123",
                wa_id: "573001112233",
              },
            ],
            messages: [
              {
                from: "573001112233",
                id: "wamid.inbound",
                text: { body: "Hola" },
                timestamp: "1760000000",
                type: "text",
              },
            ],
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "573009998877",
              phone_number_id: "778899",
            },
            statuses: [
              {
                id: "wamid.outbound",
                recipient_id: "573001112233",
                status: "delivered",
                timestamp: "1760000001",
              },
            ],
          },
        },
      ],
      id: "991122",
    },
  ],
  object: "whatsapp_business_account",
});

const createDependencies = () => {
  const integrations = {
    getByPhoneNumberId: vi.fn().mockResolvedValue(phoneIntegration),
    getByWebhookKey: vi.fn().mockResolvedValue(webhookConnection),
  };
  const credentials = {
    get: vi.fn().mockResolvedValue({
      accessToken: "t".repeat(32),
      appSecret,
      verifyToken,
    }),
  };
  const publisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };

  return { credentials, integrations, publisher };
};

describe("ReceiveWhatsappWebhook", () => {
  it("answers Meta's verification challenge using the encrypted verify token", async () => {
    const dependencies = createDependencies();
    const useCase = new ReceiveWhatsappWebhook(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.publisher,
    );

    await expect(
      useCase.verifyChallenge({
        challenge: "challenge-value",
        mode: "subscribe",
        verifyToken,
        webhookKey: "w".repeat(43),
      }),
    ).resolves.toBe("challenge-value");

    await expect(
      useCase.verifyChallenge({
        challenge: "challenge-value",
        mode: "subscribe",
        verifyToken: "incorrect",
        webhookKey: "w".repeat(43),
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_VERIFICATION_INVALID",
      statusCode: 403,
    });
  });

  it("verifies the raw-body signature and publishes message and status events", async () => {
    const dependencies = createDependencies();
    const useCase = new ReceiveWhatsappWebhook(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.publisher,
    );
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

    await expect(
      useCase.receive({
        correlationId: "corr_test",
        payload,
        rawBody,
        signature,
        webhookKey: "w".repeat(43),
      }),
    ).resolves.toEqual({
      accepted: true,
      enqueuedMessages: 1,
      enqueuedStatuses: 1,
    });

    expect(dependencies.publisher.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        integrationId: "int_test",
        kind: "MESSAGE",
        phoneNumberId: "778899",
      }),
    );
    expect(dependencies.publisher.publish).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        integrationId: "int_test",
        kind: "STATUS",
        phoneNumberId: "778899",
      }),
    );
  });

  it("rejects an invalid Meta signature without publishing", async () => {
    const dependencies = createDependencies();
    const useCase = new ReceiveWhatsappWebhook(
      dependencies.integrations,
      dependencies.credentials,
      dependencies.publisher,
    );
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");

    await expect(
      useCase.receive({
        correlationId: "corr_test",
        payload,
        rawBody,
        signature: `sha256=${"0".repeat(64)}`,
        webhookKey: "w".repeat(43),
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_SIGNATURE_INVALID",
      statusCode: 401,
    });
    expect(dependencies.publisher.publish).not.toHaveBeenCalled();
  });
});
