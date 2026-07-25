import { describe, expect, it } from "vitest";

import { resolveCorrelationId } from "../../../src/shared/http/correlation-id.js";

describe("resolveCorrelationId", () => {
  it("preserves a valid caller correlation identifier", () => {
    expect(resolveCorrelationId({ "X-Correlation-ID": "request:storagia:42" })).toBe(
      "request:storagia:42",
    );
  });

  it("generates an opaque identifier when the caller value is invalid", () => {
    expect(resolveCorrelationId({ "x-correlation-id": "contains spaces" })).toMatch(
      /^cor_[0-9A-HJKMNP-TV-Z]{26}$/,
    );
  });
});
