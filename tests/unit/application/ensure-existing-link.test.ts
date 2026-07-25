import { describe, expect, it } from "vitest";

import { EnsureTenant } from "../../../src/application/tenants/ensure-tenant.js";
import type {
  AppTenantLinkRecord,
  IdempotencyRecord,
  TenantRecord,
  TenantStore,
} from "../../../src/application/ports/tenant-store.js";

class ExistingLinkStore implements TenantStore {
  public createTenantRecords(): Promise<void> {
    return Promise.reject(new Error("An existing link must not be recreated."));
  }

  public findLinkByTenant(): Promise<AppTenantLinkRecord | undefined> {
    return Promise.resolve(undefined);
  }

  public getIdempotency(): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve(undefined);
  }

  public getLink(): Promise<AppTenantLinkRecord | undefined> {
    return Promise.resolve({
      applicationId: "app_one",
      externalAccountId: "external-42",
      requestHash: "a".repeat(64),
      status: "ACTIVE",
      tenantId: "tenant_existing",
    });
  }

  public getTenant(): Promise<TenantRecord | undefined> {
    return Promise.resolve({
      createdAt: "2026-07-25T00:00:00.000Z",
      name: "Existing tenant",
      status: "ACTIVE",
      tenantId: "tenant_existing",
    });
  }
}

describe("ensure tenant with an existing application link", () => {
  it("returns the linked tenant without creating duplicate records", async () => {
    const result = await new EnsureTenant(new ExistingLinkStore()).execute({
      applicationId: "app_one",
      idempotencyKey: "another-command",
      request: {
        externalAccountId: "external-42",
        name: "Existing tenant",
      },
    });

    expect(result).toEqual({
      created: false,
      externalAccountId: "external-42",
      status: "ACTIVE",
      tenantId: "tenant_existing",
    });
  });
});
