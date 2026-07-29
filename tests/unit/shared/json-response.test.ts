import { describe, expect, it } from "vitest";

import { jsonResponse, noContentResponse } from "../../../src/shared/http/json-response.js";

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

  it("returns an empty 204 response with correlation and security headers", () => {
    expect(noContentResponse("cor_02")).toEqual({
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-correlation-id": "cor_02",
      },
      isBase64Encoded: false,
      statusCode: 204,
    });
  });
});
