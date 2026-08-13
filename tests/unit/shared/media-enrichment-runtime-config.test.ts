import { describe, expect, it } from "vitest";

import { loadMediaEnrichmentRuntimeConfig } from "../../../src/shared/config/media-enrichment-runtime-config.js";

describe("media enrichment runtime config", () => {
  it("loads OpenAI defaults and tenant credential vault configuration", () => {
    expect(
      loadMediaEnrichmentRuntimeConfig({
        CONTROL_TABLE: "control-test",
        DATA_TABLE: "data-test",
        MEDIA_BUCKET: "media-test",
        TINKIVA_INTEGRATIONS_TABLE: "tenant-integrations-test",
        TINKIVA_KMS_KEY_ID: "arn:aws:kms:us-east-1:123:key/test",
        STAGE: "test",
        STORAGIA_APPLICATION_ID: "app_storagia",
      }),
    ).toMatchObject({
      OPENAI_AUDIO_MODEL: "gpt-4o-mini-transcribe",
      OPENAI_IMAGE_MODEL: "gpt-5.6-luna",
      TINKIVA_INTEGRATIONS_TABLE: "tenant-integrations-test",
    });
  });
});
