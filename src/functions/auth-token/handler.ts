import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { IssueAccessToken } from "../../application/auth/issue-access-token.js";
import { issueTokenRequestSchema } from "../../contracts/api/auth.contract.js";
import { dynamoDocumentClient, secretsManagerClient } from "../../infrastructure/aws/clients.js";
import { DynamoApplicationReader } from "../../infrastructure/dynamodb/dynamo-application-reader.js";
import { CachedSecretReader } from "../../infrastructure/secrets/cached-secret-reader.js";
import { loadTokenRuntimeConfig } from "../../shared/config/runtime-config.js";
import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { errorResponse } from "../../shared/http/error-response.js";
import { jsonResponse } from "../../shared/http/json-response.js";
import { readJsonBody } from "../../shared/http/request-body.js";

export interface AuthTokenHandlerDependencies {
  issueAccessToken: Pick<IssueAccessToken, "execute">;
}

export const createAuthTokenHandler =
  ({ issueAccessToken }: AuthTokenHandlerDependencies) =>
  async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    const correlationId = resolveCorrelationId(event.headers);

    try {
      const request = issueTokenRequestSchema.parse(readJsonBody(event));
      const result = await issueAccessToken.execute(request);

      return jsonResponse(200, result, correlationId);
    } catch (error) {
      return errorResponse(error, correlationId);
    }
  };

const config = loadTokenRuntimeConfig();
const applicationReader = new DynamoApplicationReader(dynamoDocumentClient, config.CONTROL_TABLE);
const secretReader = new CachedSecretReader(secretsManagerClient);

export const main = createAuthTokenHandler({
  issueAccessToken: new IssueAccessToken(applicationReader, secretReader, {
    audience: config.TOKEN_AUDIENCE,
    authPepperSecretId: config.AUTH_PEPPER_SECRET_ARN,
    issuer: config.TOKEN_ISSUER,
    jwtSigningSecretId: config.JWT_SIGNING_SECRET_ARN,
    ttlSeconds: config.TOKEN_TTL_SECONDS,
  }),
});
