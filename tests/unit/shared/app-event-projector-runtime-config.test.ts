import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadAppEventProjectorRuntimeConfig } from "../../../src/shared/config/app-event-projector-runtime-config.js";

const environment = {
  APP_EVENTS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/app-events.fifo",
  MEDIA_BUCKET: "media-test",
  STORAGIA_AUTOMATION_APPLICATION_ID: "app_storagia",
  STORAGIA_AUTOMATION_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/storagia-automation.fifo",
};

describe("app event projector runtime configuration", () => {
  it("loads both application event destinations", () => {
    expect(loadAppEventProjectorRuntimeConfig(environment)).toEqual({
      ...environment,
      MEDIA_URL_TTL_SECONDS: 300,
    });
  });

  it.each(["STORAGIA_AUTOMATION_APPLICATION_ID", "STORAGIA_AUTOMATION_QUEUE_URL"] as const)(
    "rejects a missing %s",
    (variable) => {
      const invalidEnvironment = { ...environment, [variable]: undefined };

      expect(() => loadAppEventProjectorRuntimeConfig(invalidEnvironment)).toThrow(z.ZodError);
    },
  );

  it("rejects an empty StoragIA application ID", () => {
    expect(() =>
      loadAppEventProjectorRuntimeConfig({
        ...environment,
        STORAGIA_AUTOMATION_APPLICATION_ID: "   ",
      }),
    ).toThrow(z.ZodError);
  });
});
