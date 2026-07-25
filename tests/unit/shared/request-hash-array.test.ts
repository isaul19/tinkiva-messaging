import { describe, expect, it } from "vitest";

import { hashCanonicalJson } from "../../../src/shared/crypto/request-hash.js";

describe("canonical request hashing", () => {
  it("canonicalizes objects nested inside arrays", () => {
    expect(hashCanonicalJson([{ b: 2, a: 1 }])).toBe(hashCanonicalJson([{ a: 1, b: 2 }]));
  });
});
