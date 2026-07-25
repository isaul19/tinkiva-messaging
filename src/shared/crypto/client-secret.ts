import { createHmac, timingSafeEqual } from "node:crypto";

export const digestClientSecret = (pepper: string, clientSecret: string): string =>
  createHmac("sha256", pepper).update(clientSecret, "utf8").digest("hex");

export const secretDigestMatches = (expectedDigest: string, actualDigest: string): boolean => {
  const expected = Buffer.from(expectedDigest, "hex");
  const actual = Buffer.from(actualDigest, "hex");

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
