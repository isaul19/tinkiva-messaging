import { createHash } from "node:crypto";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, canonicalize(nestedValue)]),
    );
  }

  return value;
};

export const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const hashCanonicalJson = (value: unknown): string =>
  sha256(JSON.stringify(canonicalize(value)));
