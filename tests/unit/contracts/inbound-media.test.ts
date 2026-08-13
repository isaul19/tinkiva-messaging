import { describe, expect, it } from "vitest";

import { updateInboundMediaSettingsRequestSchema } from "../../../src/contracts/api/inbound-media.contract.js";

describe("inbound media settings contract", () => {
  it("requires an explicit full replacement", () => {
    expect(
      updateInboundMediaSettingsRequestSchema.parse({
        audioAlternativeText: true,
        imageAlternativeText: false,
      }),
    ).toEqual({ audioAlternativeText: true, imageAlternativeText: false });
    expect(() =>
      updateInboundMediaSettingsRequestSchema.parse({ audioAlternativeText: true }),
    ).toThrow();
    expect(() =>
      updateInboundMediaSettingsRequestSchema.parse({
        audioAlternativeText: true,
        imageAlternativeText: false,
        arbitraryMetadata: true,
      }),
    ).toThrow();
  });
});
