import { describe, expect, it } from "vitest";

import { loadPlatformAdminRuntimeConfig } from "../../../src/shared/config/platform-admin-runtime-config.js";

describe("platform admin runtime configuration", () => {
  it("loads both DynamoDB tables", () => {
    expect(
      loadPlatformAdminRuntimeConfig({
        CONTROL_TABLE: "control-test",
        DATA_TABLE: "data-test",
        MEDIA_BUCKET: "media-test",
        PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/test",
        TINKIVA_INTEGRATIONS_TABLE: "tenant-integrations-test",
        STAGE: "test",
      }),
    ).toEqual({
      CONTROL_TABLE: "control-test",
      DATA_TABLE: "data-test",
      MEDIA_BUCKET: "media-test",
      PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/test",
      TINKIVA_INTEGRATIONS_TABLE: "tenant-integrations-test",
      STAGE: "test",
    });
  });

  it("rejects an incomplete configuration", () => {
    expect(() => loadPlatformAdminRuntimeConfig({ CONTROL_TABLE: "control-test" })).toThrow();
  });
});
