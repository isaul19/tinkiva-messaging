import { describe, expect, it } from "vitest";

import { EnsureTenant } from "../../../src/application/tenants/ensure-tenant.js";
import { GetTenant } from "../../../src/application/tenants/get-tenant.js";
import {
  TenantStoreConflictError,
  type AppTenantLinkRecord,
  type CreateTenantRecordsInput,
  type IdempotencyRecord,
  type TenantRecord,
  type TenantStore,
} from "../../../src/application/ports/tenant-store.js";

class MemoryTenantStore implements TenantStore {
  public readonly idempotency = new Map<string, IdempotencyRecord>();
  public readonly links = new Map<string, AppTenantLinkRecord>();
  public readonly tenants = new Map<string, TenantRecord>();
  public failNextCreate = false;

  public createTenantRecords(input: CreateTenantRecordsInput): Promise<void> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      return Promise.reject(new TenantStoreConflictError());
    }

    this.tenants.set(input.tenantId, {
      createdAt: input.now,
      name: input.name,
      status: "ACTIVE",
      tenantId: input.tenantId,
    });
    this.links.set(this.linkKey(input.applicationId, input.externalAccountId), {
      applicationId: input.applicationId,
      externalAccountId: input.externalAccountId,
      requestHash: input.requestHash,
      status: "ACTIVE",
      tenantId: input.tenantId,
    });
    this.idempotency.set(this.idempotencyKey(input.applicationId, input.idempotencyKeyHash), {
      requestHash: input.requestHash,
      resourceId: input.tenantId,
      status: "COMPLETED",
    });

    return Promise.resolve();
  }

  public findLinkByTenant(
    applicationId: string,
    tenantId: string,
  ): Promise<AppTenantLinkRecord | undefined> {
    return Promise.resolve(
      [...this.links.values()].find(
        (link) => link.applicationId === applicationId && link.tenantId === tenantId,
      ),
    );
  }

  public getIdempotency(
    applicationId: string,
    idempotencyKeyHash: string,
  ): Promise<IdempotencyRecord | undefined> {
    return Promise.resolve(
      this.idempotency.get(this.idempotencyKey(applicationId, idempotencyKeyHash)),
    );
  }

  public getLink(
    applicationId: string,
    externalAccountId: string,
  ): Promise<AppTenantLinkRecord | undefined> {
    return Promise.resolve(this.links.get(this.linkKey(applicationId, externalAccountId)));
  }

  public getTenant(tenantId: string): Promise<TenantRecord | undefined> {
    return Promise.resolve(this.tenants.get(tenantId));
  }

  private idempotencyKey(applicationId: string, idempotencyKeyHash: string): string {
    return `${applicationId}:${idempotencyKeyHash}`;
  }

  private linkKey(applicationId: string, externalAccountId: string): string {
    return `${applicationId}:${externalAccountId}`;
  }
}

const tenantRequest = {
  externalAccountCode: "ACCOUNT_42",
  externalAccountId: "external-42",
  metadata: {
    country: "CO",
  },
  name: "Tenant 42",
};

describe("tenant lifecycle", () => {
  it("creates once and replays the same idempotent command", async () => {
    const store = new MemoryTenantStore();
    const useCase = new EnsureTenant(store);

    const created = await useCase.execute({
      applicationId: "app_one",
      idempotencyKey: "create-42",
      request: tenantRequest,
    });
    const replayed = await useCase.execute({
      applicationId: "app_one",
      idempotencyKey: "create-42",
      request: tenantRequest,
    });

    expect(created.created).toBe(true);
    expect(replayed).toEqual({
      ...created,
      created: false,
    });
    expect(store.tenants).toHaveLength(1);
  });

  it("rejects reusing an idempotency key with a different request", async () => {
    const store = new MemoryTenantStore();
    const useCase = new EnsureTenant(store);
    await useCase.execute({
      applicationId: "app_one",
      idempotencyKey: "create-42",
      request: tenantRequest,
    });

    await expect(
      useCase.execute({
        applicationId: "app_one",
        idempotencyKey: "create-42",
        request: {
          ...tenantRequest,
          name: "Different tenant",
        },
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      statusCode: 409,
    });
  });

  it("isolates tenant lookups by application", async () => {
    const store = new MemoryTenantStore();
    const ensure = new EnsureTenant(store);
    const query = new GetTenant(store);
    const created = await ensure.execute({
      applicationId: "app_one",
      idempotencyKey: "create-42",
      request: tenantRequest,
    });

    await expect(query.byTenantId("app_one", created.tenantId)).resolves.toEqual({
      externalAccountId: "external-42",
      status: "ACTIVE",
      tenantId: created.tenantId,
    });
    await expect(query.byExternalAccount("app_one", "external-42")).resolves.toMatchObject({
      tenantId: created.tenantId,
    });
    await expect(query.byTenantId("app_two", created.tenantId)).rejects.toMatchObject({
      code: "TENANT_ACCESS_DENIED",
    });
    await expect(query.byExternalAccount("app_two", "external-42")).rejects.toMatchObject({
      code: "TENANT_NOT_FOUND",
    });
  });
});
