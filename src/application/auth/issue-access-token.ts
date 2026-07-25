import { SignJWT } from "jose";
import { ulid } from "ulid";
import { z } from "zod";

import type { IssueTokenRequest, IssueTokenResponse } from "../../contracts/api/auth.contract.js";
import { digestClientSecret, secretDigestMatches } from "../../shared/crypto/client-secret.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import type { ApplicationReader } from "../ports/application-reader.js";
import type { SecretReader } from "../ports/secret-reader.js";

const secretValueSchema = z.looseObject({
  value: z.string().min(32),
});

export interface IssueAccessTokenConfig {
  authPepperSecretId: string;
  audience: string;
  issuer: string;
  jwtSigningSecretId: string;
  ttlSeconds: number;
}

export class IssueAccessToken {
  readonly #applications: ApplicationReader;
  readonly #config: IssueAccessTokenConfig;
  readonly #secrets: SecretReader;

  public constructor(
    applications: ApplicationReader,
    secrets: SecretReader,
    config: IssueAccessTokenConfig,
  ) {
    this.#applications = applications;
    this.#secrets = secrets;
    this.#config = config;
  }

  public async execute(request: IssueTokenRequest): Promise<IssueTokenResponse> {
    const pepper = await this.#secrets.getJson(this.#config.authPepperSecretId, secretValueSchema);
    const client = await this.#applications.getClient(request.clientId);
    const actualDigest = digestClientSecret(pepper.value, request.clientSecret);
    const expectedDigest = client?.secretDigest ?? "0".repeat(64);
    const validSecret = secretDigestMatches(expectedDigest, actualDigest);

    if (client?.status !== "ACTIVE" || !validSecret) {
      throw invalidClientError();
    }

    const application = await this.#applications.getApplication(client.applicationId);

    if (application?.status !== "ACTIVE") {
      throw invalidClientError();
    }

    const signingSecret = await this.#secrets.getJson(
      this.#config.jwtSigningSecretId,
      secretValueSchema,
    );
    const scope = client.scopes.join(" ");
    const accessToken = await new SignJWT({
      client_id: client.clientId,
      scope,
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "JWT",
      })
      .setAudience(this.#config.audience)
      .setExpirationTime(Math.floor(Date.now() / 1_000) + this.#config.ttlSeconds)
      .setIssuedAt()
      .setIssuer(this.#config.issuer)
      .setJti(ulid())
      .setSubject(application.applicationId)
      .sign(new TextEncoder().encode(signingSecret.value));

    return {
      accessToken,
      expiresIn: this.#config.ttlSeconds,
      tokenType: "Bearer",
    };
  }
}

const invalidClientError = (): ApplicationError =>
  new ApplicationError("AUTH_INVALID_CLIENT", "The application credentials are invalid.", 401);
