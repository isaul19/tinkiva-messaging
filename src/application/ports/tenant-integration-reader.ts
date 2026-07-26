import type { TenantIntegrationListItem } from "../../contracts/api/integration-list.contract.js";

export interface TenantIntegrationReader {
  list(input: { applicationId: string; tenantId: string }): Promise<TenantIntegrationListItem[]>;
}
