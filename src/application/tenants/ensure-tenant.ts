import { ulid } from "ulid";

import type {
  EnsureTenantRequest,
  EnsureTenantResponse,
} from "../../contracts/api/tenant.contract.js";
import { hashCanonicalJson, sha256 } from "../../shared/crypto/request-hash.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import {
  TenantStoreConflictError,
  type TenantRecord,
  type TenantStore,
} from "../ports/tenant-store.js";

export interface EnsureTenantCommand {
  applicationId: string;
  idempotencyKey: string;
  request: EnsureTenantRequest;
}

export type EnsureTenantResult = EnsureTenantResponse & {
  created: boolean;
};

export class EnsureTenant {
  readonly #store: TenantStore;

  public constructor(store: TenantStore) {
    this.#store = store;
  }

  public async execute(command: EnsureTenantCommand): Promise<EnsureTenantResult> {
    const idempotencyKeyHash = sha256(command.idempotencyKey);
    const requestHash = hashCanonicalJson(command.request);
    const existing = await this.#store.getIdempotency(command.applicationId, idempotencyKeyHash);

    if (existing !== undefined) {
      return this.#replay(
        command.request.externalAccountId,
        requestHash,
        existing.requestHash,
        existing.resourceId,
      );
    }

    const existingLink = await this.#store.getLink(
      command.applicationId,
      command.request.externalAccountId,
    );

    if (existingLink !== undefined) {
      const tenant = await this.#requiredTenant(existingLink.tenantId);
      return toResult(command.request.externalAccountId, tenant, false);
    }

    const tenantId = `tenant_${ulid()}`;
    const now = new Date();

    try {
      await this.#store.createTenantRecords({
        applicationId: command.applicationId,
        externalAccountId: command.request.externalAccountId,
        idempotencyKeyHash,
        idempotencyExpiresAt: Math.floor(now.getTime() / 1_000) + 7 * 24 * 60 * 60,
        name: command.request.name,
        now: now.toISOString(),
        requestHash,
        tenantId,
        ...(command.request.externalAccountCode === undefined
          ? {}
          : { externalAccountCode: command.request.externalAccountCode }),
        ...(command.request.metadata === undefined ? {} : { metadata: command.request.metadata }),
      });
    } catch (error) {
      if (!(error instanceof TenantStoreConflictError)) {
        throw error;
      }

      const racedIdempotency = await this.#store.getIdempotency(
        command.applicationId,
        idempotencyKeyHash,
      );

      if (racedIdempotency !== undefined) {
        return this.#replay(
          command.request.externalAccountId,
          requestHash,
          racedIdempotency.requestHash,
          racedIdempotency.resourceId,
        );
      }

      const racedLink = await this.#store.getLink(
        command.applicationId,
        command.request.externalAccountId,
      );

      if (racedLink !== undefined) {
        const tenant = await this.#requiredTenant(racedLink.tenantId);
        return toResult(command.request.externalAccountId, tenant, false);
      }

      throw error;
    }

    return {
      created: true,
      externalAccountId: command.request.externalAccountId,
      status: "ACTIVE",
      tenantId,
    };
  }

  async #replay(
    externalAccountId: string,
    actualRequestHash: string,
    expectedRequestHash: string,
    tenantId: string,
  ): Promise<EnsureTenantResult> {
    if (actualRequestHash !== expectedRequestHash) {
      throw new ApplicationError(
        "IDEMPOTENCY_KEY_REUSED",
        "The idempotency key was already used with a different request.",
        409,
      );
    }

    const tenant = await this.#requiredTenant(tenantId);
    return toResult(externalAccountId, tenant, false);
  }

  async #requiredTenant(tenantId: string): Promise<TenantRecord> {
    const tenant = await this.#store.getTenant(tenantId);

    if (tenant === undefined) {
      throw new ApplicationError("INTERNAL_ERROR", "The tenant record is inconsistent.", 500, true);
    }

    return tenant;
  }
}

const toResult = (
  externalAccountId: string,
  tenant: TenantRecord,
  created: boolean,
): EnsureTenantResult => ({
  created,
  externalAccountId,
  status: tenant.status,
  tenantId: tenant.tenantId,
});
