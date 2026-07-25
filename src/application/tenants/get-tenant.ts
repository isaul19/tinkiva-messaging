import type { EnsureTenantResponse } from "../../contracts/api/tenant.contract.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import type { AppTenantLinkRecord, TenantRecord, TenantStore } from "../ports/tenant-store.js";

export class GetTenant {
  readonly #store: TenantStore;

  public constructor(store: TenantStore) {
    this.#store = store;
  }

  public async byExternalAccount(
    applicationId: string,
    externalAccountId: string,
  ): Promise<EnsureTenantResponse> {
    const link = await this.#store.getLink(applicationId, externalAccountId);

    if (link?.status !== "ACTIVE") {
      throw tenantNotFoundError();
    }

    const tenant = await this.#requiredTenant(link.tenantId);
    return toResponse(link, tenant);
  }

  public async byTenantId(applicationId: string, tenantId: string): Promise<EnsureTenantResponse> {
    const link = await this.#store.findLinkByTenant(applicationId, tenantId);

    if (link?.status !== "ACTIVE") {
      throw new ApplicationError(
        "TENANT_ACCESS_DENIED",
        "The application does not have access to the requested tenant.",
        403,
      );
    }

    const tenant = await this.#requiredTenant(tenantId);
    return toResponse(link, tenant);
  }

  async #requiredTenant(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.#store.getTenant(tenantId);

    if (tenant === undefined) {
      throw tenantNotFoundError();
    }

    return tenant;
  }
}

const tenantNotFoundError = (): ApplicationError =>
  new ApplicationError("TENANT_NOT_FOUND", "The requested tenant does not exist.", 404);

const toResponse = (link: AppTenantLinkRecord, tenant: TenantRecord): EnsureTenantResponse => ({
  externalAccountId: link.externalAccountId,
  status: tenant.status,
  tenantId: tenant.tenantId,
});
