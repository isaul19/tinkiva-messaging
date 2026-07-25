import type {
  APIGatewayAuthorizerResultContext,
  APIGatewayRequestAuthorizerEventV2,
} from "aws-lambda";

import { VerifyAccessToken } from "../../application/auth/verify-access-token.js";
import { dynamoDocumentClient, secretsManagerClient } from "../../infrastructure/aws/clients.js";
import { DynamoApplicationReader } from "../../infrastructure/dynamodb/dynamo-application-reader.js";
import { CachedSecretReader } from "../../infrastructure/secrets/cached-secret-reader.js";
import { loadTokenRuntimeConfig } from "../../shared/config/runtime-config.js";

type AuthorizerContext = APIGatewayAuthorizerResultContext & {
  applicationId: string;
  clientId: string;
  scope: string;
};

interface AuthorizerResult {
  context?: AuthorizerContext;
  isAuthorized: boolean;
}

export interface AuthorizerHandlerDependencies {
  verifyAccessToken: Pick<VerifyAccessToken, "execute">;
}

export const createAuthorizerHandler =
  ({ verifyAccessToken }: AuthorizerHandlerDependencies) =>
  async (event: APIGatewayRequestAuthorizerEventV2): Promise<AuthorizerResult> => {
    const authorization = event.identitySource[0] ?? event.headers?.authorization;
    const accessToken = readBearerToken(authorization);

    if (accessToken === undefined) {
      return {
        isAuthorized: false,
      };
    }

    try {
      const identity = await verifyAccessToken.execute(accessToken);

      return {
        context: {
          applicationId: identity.applicationId,
          clientId: identity.clientId,
          scope: identity.scopes.join(" "),
        },
        isAuthorized: true,
      };
    } catch {
      return {
        isAuthorized: false,
      };
    }
  };

const readBearerToken = (authorization: string | undefined): string | undefined => {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  return match?.[1];
};

const config = loadTokenRuntimeConfig();
const applicationReader = new DynamoApplicationReader(dynamoDocumentClient, config.CONTROL_TABLE);
const secretReader = new CachedSecretReader(secretsManagerClient);

export const main = createAuthorizerHandler({
  verifyAccessToken: new VerifyAccessToken(applicationReader, secretReader, {
    audience: config.TOKEN_AUDIENCE,
    issuer: config.TOKEN_ISSUER,
    jwtSigningSecretId: config.JWT_SIGNING_SECRET_ARN,
  }),
});
