import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadWhatsappSenderRuntimeConfig } from "../../../src/shared/config/whatsapp-sender-runtime-config.js";
import { loadWhatsappWebhookRuntimeConfig } from "../../../src/shared/config/whatsapp-webhook-runtime-config.js";

describe("WhatsApp runtime configuration", () => {
  it("loads sender settings", () => {
    const environment = {
      CONTROL_TABLE: "control-test",
      DATA_TABLE: "data-test",
      MEDIA_BUCKET: "media-test",
      PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
      STAGE: "test",
    };

    expect(loadWhatsappSenderRuntimeConfig(environment)).toEqual({
      ...environment,
      MEDIA_URL_TTL_SECONDS: 900,
    });
  });

  it("loads webhook settings and rejects an invalid queue URL", () => {
    const environment = {
      CONTROL_TABLE: "control-test",
      INBOUND_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/inbound.fifo",
      PROVIDER_CREDENTIALS_KEY_ARN: "arn:aws:kms:us-east-1:123:key/test",
      STAGE: "test",
    };

    expect(loadWhatsappWebhookRuntimeConfig(environment)).toEqual(environment);
    expect(() =>
      loadWhatsappWebhookRuntimeConfig({
        ...environment,
        INBOUND_QUEUE_URL: "not-a-url",
      }),
    ).toThrow(z.ZodError);
  });
});
