import { createHmac } from "node:crypto";

import { decodeJwt, jwtVerify, type JWTPayload } from "jose";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { IssueAccessToken } from "../../../src/application/auth/issue-access-token.js";
import { VerifyAccessToken } from "../../../src/application/auth/verify-access-token.js";
import type {
  ApplicationClientRecord,
  ApplicationReader,
  ApplicationRecord,
} from "../../../src/application/ports/application-reader.js";
import type { SecretReader } from "../../../src/application/ports/secret-reader.js";
import { ApplicationError } from "../../../src/shared/errors/application-error.js";

const pepper = "p".repeat(64);
const signingSecret = "s".repeat(64);
const clientSecret = `msgs_${"c".repeat(48)}`;

class FakeApplicationReader implements ApplicationReader {
  public application: ApplicationRecord | undefined = {
    applicationId: "app_test",
    code: "TEST",
    name: "Test application",
    status: "ACTIVE",
  };

  public client: ApplicationClientRecord | undefined = {
    applicationId: "app_test",
    clientId: "msgc_test",
    scopes: ["tenants:read", "tenants:write"],
    secretDigest: createHmac("sha256", pepper).update(clientSecret).digest("hex"),
    status: "ACTIVE",
  };

  public getApplication(): Promise<ApplicationRecord | undefined> {
    return Promise.resolve(this.application);
  }

  public getClient(): Promise<ApplicationClientRecord | undefined> {
    return Promise.resolve(this.client);
  }
}

class FakeSecretReader implements SecretReader {
  public getJson<TSchema extends z.ZodType>(
    secretId: string,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const value = secretId === "pepper-secret" ? pepper : signingSecret;
    return Promise.resolve(schema.parse({ value }));
  }
}

const config = {
  audience: "tinkiva-messaging-gateway",
  authPepperSecretId: "pepper-secret",
  issuer: "https://messaging-api.tinkiva.com",
  jwtSigningSecretId: "signing-secret",
  ttlSeconds: 900,
};

describe("application authentication", () => {
  it("issues a signed, short-lived token without exposing credentials", async () => {
    const reader = new FakeApplicationReader();
    const useCase = new IssueAccessToken(reader, new FakeSecretReader(), config);

    const result = await useCase.execute({
      clientId: "msgc_test",
      clientSecret,
    });
    const verified = await jwtVerify(result.accessToken, new TextEncoder().encode(signingSecret), {
      audience: config.audience,
      issuer: config.issuer,
    });

    expect(result).toMatchObject({
      expiresIn: 900,
      tokenType: "Bearer",
    });
    expect(verified.payload).toMatchObject({
      client_id: "msgc_test",
      scope: "tenants:read tenants:write",
      sub: "app_test",
    });
    expect(JSON.stringify(result)).not.toContain(clientSecret);
  });

  it("returns the same public authentication error for an invalid secret or disabled app", async () => {
    const reader = new FakeApplicationReader();
    const useCase = new IssueAccessToken(reader, new FakeSecretReader(), config);

    await expect(
      useCase.execute({
        clientId: "msgc_test",
        clientSecret: `msgs_${"x".repeat(48)}`,
      }),
    ).rejects.toMatchObject({
      code: "AUTH_INVALID_CLIENT",
      statusCode: 401,
    });

    const application = reader.application;
    if (application === undefined) {
      throw new Error("Test fixture application is missing.");
    }
    reader.application = {
      ...application,
      status: "DISABLED",
    };

    await expect(
      useCase.execute({
        clientId: "msgc_test",
        clientSecret,
      }),
    ).rejects.toBeInstanceOf(ApplicationError);
  });

  it("authorizes a valid token and rejects stale scopes or invalid signatures", async () => {
    const reader = new FakeApplicationReader();
    const issuer = new IssueAccessToken(reader, new FakeSecretReader(), config);
    const verifier = new VerifyAccessToken(reader, new FakeSecretReader(), {
      audience: config.audience,
      issuer: config.issuer,
      jwtSigningSecretId: config.jwtSigningSecretId,
    });
    const token = (
      await issuer.execute({
        clientId: "msgc_test",
        clientSecret,
      })
    ).accessToken;

    await expect(verifier.execute(token)).resolves.toEqual({
      applicationId: "app_test",
      clientId: "msgc_test",
      scopes: ["tenants:read", "tenants:write"],
    });

    const client = reader.client;
    if (client === undefined) {
      throw new Error("Test fixture client is missing.");
    }
    reader.client = {
      ...client,
      scopes: ["tenants:read"],
    };
    await expect(verifier.execute(token)).rejects.toMatchObject({
      code: "AUTH_INVALID_TOKEN",
    });

    const payload: JWTPayload = decodeJwt(token);
    expect(payload.sub).toBe("app_test");
    await expect(verifier.execute(`${token.slice(0, -1)}x`)).rejects.toMatchObject({
      code: "AUTH_INVALID_TOKEN",
    });
  });
});
