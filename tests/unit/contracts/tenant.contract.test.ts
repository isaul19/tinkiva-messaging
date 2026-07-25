import { describe, expect, it } from "vitest";

import { ensureTenantRequestSchema } from "../../../src/contracts/index.js";

describe("ensureTenantRequestSchema", () => {
  it("accepts an external account reference without assuming UUID identifiers", () => {
    const result = ensureTenantRequestSchema.parse({
      externalAccountCode: "MADELU",
      externalAccountId: "clinic-legacy-42",
      metadata: {
        country: "PE",
        migrated: false,
      },
      name: "Corporación Madelu",
    });

    expect(result.externalAccountId).toBe("clinic-legacy-42");
  });

  it("rejects unknown properties in a sensitive command", () => {
    const result = ensureTenantRequestSchema.safeParse({
      externalAccountId: "account-42",
      name: "Tenant",
      applicationId: "app_spoofed",
    });

    expect(result.success).toBe(false);
  });
});
