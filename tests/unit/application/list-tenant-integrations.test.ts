import { describe, expect, it, vi } from "vitest";

import type { TenantIntegrationReader } from "../../../src/application/ports/tenant-integration-reader.js";
import { ListTenantIntegrations } from "../../../src/application/integrations/list-tenant-integrations.js";

describe("ListTenantIntegrations", () => {
  it("returns the tenant and its non-secret integration metadata", async () => {
    const items = [
      {
        createdAt: "2026-07-25T20:00:00.000Z",
        credentialVersion: 2,
        displayName: "Storagia WhatsApp",
        inboundMedia: {
          audioAlternativeText: true,
          imageAlternativeText: false,
        },
        integrationId: "int_01JTESTLIST000000000000000",
        phoneNumberId: "1265721213282879",
        provider: "WHATSAPP" as const,
        providerAccountId: "1265721213282879",
        status: "ACTIVE" as const,
        tenantId: "tenant_01JTESTLIST0000000000000",
      },
    ];
    const reader = {
      list: vi.fn().mockResolvedValue(items),
    } satisfies TenantIntegrationReader;
    const useCase = new ListTenantIntegrations(reader);

    await expect(
      useCase.execute({
        applicationId: "app_test",
        tenantId: "tenant_01JTESTLIST0000000000000",
      }),
    ).resolves.toEqual({
      items,
      tenantId: "tenant_01JTESTLIST0000000000000",
    });
  });
});
