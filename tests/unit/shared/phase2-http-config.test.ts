import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  accessTokenClaimsSchema,
  tokenRequestSchema,
  tokenResponseSchema,
} from "../../../src/contracts/api/auth.contract.js";
import {
  loadBaseRuntimeConfig,
  loadTokenRuntimeConfig,
} from "../../../src/shared/config/runtime-config.js";
import { ApplicationError } from "../../../src/shared/errors/application-error.js";
import { errorResponse } from "../../../src/shared/http/error-response.js";
import { readHeader, readJsonBody } from "../../../src/shared/http/request-body.js";

const eventWithBody = (body: string, isBase64Encoded = false) =>
  ({
    body,
    headers: {},
    isBase64Encoded,
  }) as APIGatewayProxyEventV2;

describe("phase 2 HTTP contracts and runtime configuration", () => {
  it("validates authentication requests, responses, and JWT claims", () => {
    expect(
      tokenRequestSchema.parse({
        clientId: "msgc_client_01",
        clientSecret: `msgs_${"s".repeat(40)}`,
      }),
    ).toMatchObject({ clientId: "msgc_client_01" });
    expect(
      tokenResponseSchema.parse({
        accessToken: "signed-token",
        expiresIn: 900,
        tokenType: "Bearer",
      }),
    ).toMatchObject({ tokenType: "Bearer" });
    expect(
      accessTokenClaimsSchema.parse({
        aud: ["gateway"],
        client_id: "msgc_client_01",
        exp: 2,
        iat: 1,
        iss: "https://messaging-api.tinkiva.com",
        jti: "token_01",
        scope: "tenants:read",
        sub: "app_01",
      }),
    ).toMatchObject({ sub: "app_01" });
    expect(
      tokenRequestSchema.safeParse({
        clientId: "invalid",
        clientSecret: "short",
      }).success,
    ).toBe(false);
  });

  it("loads and rejects runtime configuration at the boundary", () => {
    expect(loadBaseRuntimeConfig({ CONTROL_TABLE: "messaging-control-test" })).toEqual({
      CONTROL_TABLE: "messaging-control-test",
    });
    expect(
      loadTokenRuntimeConfig({
        AUTH_PEPPER_SECRET_ARN: "pepper",
        CONTROL_TABLE: "messaging-control-test",
        JWT_SIGNING_SECRET_ARN: "signing",
        TOKEN_AUDIENCE: "gateway",
        TOKEN_ISSUER: "https://messaging-api.tinkiva.com",
        TOKEN_TTL_SECONDS: "900",
      }),
    ).toMatchObject({
      TOKEN_TTL_SECONDS: 900,
    });
    expect(() => loadBaseRuntimeConfig({})).toThrow(z.ZodError);
  });

  it("parses plain and base64 JSON and resolves headers case-insensitively", () => {
    expect(readJsonBody(eventWithBody('{"name":"plain"}'))).toEqual({ name: "plain" });
    expect(
      readJsonBody(eventWithBody(Buffer.from('{"name":"encoded"}').toString("base64"), true)),
    ).toEqual({ name: "encoded" });
    expect(readHeader({ "IDEMPOTENCY-KEY": " key-01 " }, "Idempotency-Key")).toBe(" key-01 ");
    expect(readHeader({}, "missing")).toBeUndefined();
    expect(() => readJsonBody({ headers: {} } as APIGatewayProxyEventV2)).toThrow(ApplicationError);
    expect(() => readJsonBody(eventWithBody("{invalid"))).toThrow(ApplicationError);
  });

  it("maps public, validation, and unknown errors without leaking internals", () => {
    const publicResult = errorResponse(
      new ApplicationError("AUTH_SCOPE_MISSING", "Missing scope.", 403),
      "cor_public",
    );
    const validationResult = errorResponse(z.string().parse.bind(z.string()), "cor_unused");
    const zodError = z.string().safeParse(42).error;
    const validationResponse = errorResponse(zodError, "cor_validation");
    const unknownResponse = errorResponse(new Error("database details"), "cor_internal");

    expect(publicResult.statusCode).toBe(403);
    expect(validationResult.statusCode).toBe(500);
    expect(validationResponse.statusCode).toBe(400);
    expect(unknownResponse).toMatchObject({
      statusCode: 500,
    });
    expect(unknownResponse.body).not.toContain("database details");
  });
});
