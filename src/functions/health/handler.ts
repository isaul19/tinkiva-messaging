import type { APIGatewayProxyHandlerV2 } from "aws-lambda";

import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { jsonResponse } from "../../shared/http/json-response.js";

export const main: APIGatewayProxyHandlerV2 = (event) => {
  const correlationId = resolveCorrelationId(event.headers);

  return Promise.resolve(
    jsonResponse(
      200,
      {
        service: "tinkiva-messaging-gateway",
        status: "ok",
      },
      correlationId,
    ),
  );
};
