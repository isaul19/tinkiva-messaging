import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadInboundProcessorRuntimeConfig } from "../../../src/shared/config/inbound-processor-runtime-config.js";

describe("inbound processor runtime configuration", () => {
  it("loads both DynamoDB table names", () => {
    expect(
      loadInboundProcessorRuntimeConfig({
        CONTROL_TABLE: "messaging-control-test",
        DATA_TABLE: "messaging-data-test",
      }),
    ).toEqual({
      CONTROL_TABLE: "messaging-control-test",
      DATA_TABLE: "messaging-data-test",
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
