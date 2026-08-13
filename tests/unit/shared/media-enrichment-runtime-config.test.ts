import { describe, expect, it } from "vitest";

import { loadMediaEnrichmentRuntimeConfig } from "../../../src/shared/config/media-enrichment-runtime-config.js";

describe("media enrichment runtime config", () => {
  it("loads OpenAI defaults and per-integration credential vault configuration", () => {
    expect(
      loadMediaEnrichmentRuntimeConfig({
        CONTROL_TABLE: "control-test",
        DATA_TABLE: "data-test",
        MEDIA_BUCKET: "media-test",
        PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
        STAGE: "test",
      }),
    ).toMatchObject({
      OPENAI_AUDIO_MODEL: "gpt-4o-mini-transcribe",
      OPENAI_IMAGE_MODEL: "gpt-5.6-luna",
    });
  });
});
