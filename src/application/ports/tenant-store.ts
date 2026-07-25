export interface TenantRecord {
  createdAt: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  tenantId: string;
}

export interface AppTenantLinkRecord {
  applicationId: string;
  externalAccountId: string;
  requestHash: string;
  status: "ACTIVE" | "SUSPENDED";
  tenantId: string;
}

export interface IdempotencyRecord {
  requestHash: string;
  resourceId: string;
  status: "COMPLETED";
}

export interface CreateTenantRecordsInput {
  applicationId: string;
  externalAccountCode?: string;
  externalAccountId: string;
  idempotencyKeyHash: string;
  idempotencyExpiresAt: number;
  metadata?: Record<string, boolean | null | number | string>;
  name: string;
  now: string;
  requestHash: string;
  tenantId: string;
}

export class TenantStoreConflictError extends Error {
  public constructor() {
    super("Tenant transaction conflicted with an existing record.");
    this.name = "TenantStoreConflictError";
  }
}

export interface TenantStore {
  createTenantRecords(input: CreateTenantRecordsInput): Promise<void>;
  findLinkByTenant(
    applicationId: string,
    tenantId: string,
  ): Promise<AppTenantLinkRecord | undefined>;
  getIdempotency(
    applicationId: string,
    idempotencyKeyHash: string,
  ): Promise<IdempotencyRecord | undefined>;
  getLink(
    applicationId: string,
    externalAccountId: string,
  ): Promise<AppTenantLinkRecord | undefined>;
  getTenant(tenantId: string): Promise<TenantRecord | undefined>;
}
