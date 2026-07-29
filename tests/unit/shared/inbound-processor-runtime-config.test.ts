import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadInboundProcessorRuntimeConfig } from "../../../src/shared/config/inbound-processor-runtime-config.js";

describe("inbound processor runtime configuration", () => {
  it("loads both DynamoDB table names", () => {
    expect(
      loadInboundProcessorRuntimeConfig({
        CONTROL_TABLE: "messaging-control-test",
        DATA_TABLE: "messaging-data-test",
        MEDIA_BUCKET: "media-test",
        PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
        STAGE: "test",
      }),
    ).toEqual({
      CONTROL_TABLE: "messaging-control-test",
      DATA_TABLE: "messaging-data-test",
      MEDIA_BUCKET: "media-test",
      MEDIA_URL_TTL_SECONDS: 300,
      PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
      STAGE: "test",
    });
  });

  it("rejects a missing data table", () => {
    expect(() =>
      loadInboundProcessorRuntimeConfig({
        CONTROL_TABLE: "messaging-control-test",
      }),
    ).toThrow(z.ZodError);
  });
});
