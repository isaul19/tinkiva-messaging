import { jwtVerify } from "jose";
import { z } from "zod";

import { ApplicationError } from "../../shared/errors/application-error.js";
import type { ApplicationReader, ApplicationScope } from "../ports/application-reader.js";
import type { SecretReader } from "../ports/secret-reader.js";

const secretValueSchema = z.looseObject({
  value: z.string().min(32),
});

const tokenClaimsSchema = z.object({
  client_id: z.string().min(1),
  scope: z.string(),
  sub: z.string().min(1),
});

export interface VerifiedApplicationIdentity {
  applicationId: string;
  clientId: string;
  scopes: ApplicationScope[];
}

export interface VerifyAccessTokenConfig {
  audience: string;
  issuer: string;
  jwtSigningSecretId: string;
}

export class VerifyAccessToken {
  readonly #applications: ApplicationReader;
  readonly #config: VerifyAccessTokenConfig;
  readonly #secrets: SecretReader;

  public constructor(
    applications: ApplicationReader,
    secrets: SecretReader,
    config: VerifyAccessTokenConfig,
  ) {
    this.#applications = applications;
    this.#secrets = secrets;
    this.#config = config;
  }

  public async execute(accessToken: string): Promise<VerifiedApplicationIdentity> {
    try {
      const signingSecret = await this.#secrets.getJson(
        this.#config.jwtSigningSecretId,
        secretValueSchema,
      );
      const verification = await jwtVerify(
        accessToken,
        new TextEncoder().encode(signingSecret.value),
        {
          algorithms: ["HS256"],
          audience: this.#config.audience,
          issuer: this.#config.issuer,
        },
      );
      const claims = tokenClaimsSchema.parse(verification.payload);
      const client = await this.#applications.getClient(claims.client_id);

      if (
        client?.status !== "ACTIVE" ||
        client.applicationId !== claims.sub ||
        claims.scope !== client.scopes.join(" ")
      ) {
        throw invalidTokenError();
      }

      const application = await this.#applications.getApplication(client.applicationId);

      if (application?.status !== "ACTIVE") {
        throw invalidTokenError();
      }

      return {
        applicationId: application.applicationId,
        clientId: client.clientId,
        scopes: client.scopes,
      };
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw invalidTokenError();
    }
  }
}

const invalidTokenError = (): ApplicationError =>
  new ApplicationError("AUTH_INVALID_TOKEN", "The access token is invalid.", 401);
