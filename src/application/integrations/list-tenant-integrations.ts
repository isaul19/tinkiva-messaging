import type { TenantIntegrationReader } from "../ports/tenant-integration-reader.js";
import type { ListTenantIntegrationsResponse } from "../../contracts/api/integration-list.contract.js";

export class ListTenantIntegrations {
  readonly #integrations: TenantIntegrationReader;

  public constructor(integrations: TenantIntegrationReader) {
    this.#integrations = integrations;
  }

  public async execute(input: {
    applicationId: string;
    tenantId: string;
  }): Promise<ListTenantIntegrationsResponse> {
    return {
      items: await this.#integrations.list(input),
      tenantId: input.tenantId,
    };
  }
}
