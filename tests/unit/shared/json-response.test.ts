import { describe, expect, it } from "vitest";

import { jsonResponse } from "../../../src/shared/http/json-response.js";

describe("jsonResponse", () => {
  it("sets safe response headers without leaking infrastructure details", () => {
    const response = jsonResponse(200, { status: "ok" }, "cor_01");

    expect(response).toEqual({
      body: '{"status":"ok"}',
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-correlation-id": "cor_01",
      },
      isBase64Encoded: false,
      statusCode: 200,
    });
  });
});
