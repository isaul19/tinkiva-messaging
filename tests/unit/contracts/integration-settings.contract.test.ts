import { describe, expect, it } from "vitest";

import {
  registerTelegramIntegrationRequestSchema,
  telegramIntegrationResponseSchema,
} from "../../../src/contracts/api/integration.contract.js";
import { listTenantIntegrationsResponseSchema } from "../../../src/contracts/api/integration-list.contract.js";
import { completeWhatsappEmbeddedSignupRequestSchema } from "../../../src/contracts/api/whatsapp-embedded-signup.contract.js";
import { registerWhatsappIntegrationRequestSchema } from "../../../src/contracts/api/whatsapp-integration.contract.js";

const disabledInboundMedia = {
  audioAlternativeText: false,
  imageAlternativeText: false,
};

describe("integration inbound media settings", () => {
  it("defaults both enrichment options to false for legacy registration requests", () => {
    expect(
      registerTelegramIntegrationRequestSchema.parse({
        botToken: "123456789:telegram-bot-token-for-unit-tests",
        displayName: "Support bot",
      }).inboundMedia,
    ).toEqual(disabledInboundMedia);
    expect(
      registerWhatsappIntegrationRequestSchema.parse({
        accessToken: "a".repeat(32),
        appSecret: "s".repeat(32),
        displayName: "WhatsApp Sales",
        metaAppId: "445566",
        phoneNumberId: "778899",
        wabaId: "991122",
      }).inboundMedia,
    ).toEqual(disabledInboundMedia);
    expect(
      completeWhatsappEmbeddedSignupRequestSchema.parse({
        authorizationCode: "one-time-authorization-code",
        displayName: "WhatsApp Sales",
        phoneNumberId: "778899",
        wabaId: "991122",
      }).inboundMedia,
    ).toEqual(disabledInboundMedia);
  });

  it("allows independent activation and defaults omitted nested options", () => {
    expect(
      registerTelegramIntegrationRequestSchema.parse({
        botToken: "123456789:telegram-bot-token-for-unit-tests",
        displayName: "Support bot",
        inboundMedia: { audioAlternativeText: true },
      }).inboundMedia,
    ).toEqual({
      audioAlternativeText: true,
      imageAlternativeText: false,
    });
    expect(
      registerWhatsappIntegrationRequestSchema.parse({
        accessToken: "a".repeat(32),
        appSecret: "s".repeat(32),
        displayName: "WhatsApp Sales",
        inboundMedia: { imageAlternativeText: true },
        metaAppId: "445566",
        phoneNumberId: "778899",
        wabaId: "991122",
      }).inboundMedia,
    ).toEqual({
      audioAlternativeText: false,
      imageAlternativeText: true,
    });
  });

  it("rejects unknown or non-boolean enrichment settings", () => {
    const base = {
      botToken: "123456789:telegram-bot-token-for-unit-tests",
      displayName: "Support bot",
    };

    expect(
      registerTelegramIntegrationRequestSchema.safeParse({
        ...base,
        inboundMedia: { audioAlternativeText: "yes" },
      }).success,
    ).toBe(false);
    expect(
      registerTelegramIntegrationRequestSchema.safeParse({
        ...base,
        inboundMedia: { generateAlternativeText: true },
      }).success,
    ).toBe(false);
  });

  it("defaults legacy integration responses and list items without requiring a migration", () => {
    const telegram = telegramIntegrationResponseSchema.parse({
      botId: "123456789",
      displayName: "Support bot",
      integrationId: "int_telegram",
      provider: "TELEGRAM",
      status: "ACTIVE",
      tenantId: "tenant_test",
      webhookUrl: "https://gateway.example/webhooks/telegram/opaque",
    });
    const listed = listTenantIntegrationsResponseSchema.parse({
      items: [
        {
          botId: "123456789",
          createdAt: "2026-08-12T12:00:00.000Z",
          credentialVersion: 1,
          displayName: "Support bot",
          integrationId: "int_telegram",
          provider: "TELEGRAM",
          providerAccountId: "123456789",
          status: "ACTIVE",
          tenantId: "tenant_test",
        },
      ],
      tenantId: "tenant_test",
    });

    expect(telegram.inboundMedia).toEqual(disabledInboundMedia);
    expect(listed.items[0]?.inboundMedia).toEqual(disabledInboundMedia);
  });
});
