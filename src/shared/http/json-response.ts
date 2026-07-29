import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

export const jsonResponse = (
  statusCode: number,
  body: unknown,
  correlationId: string,
): APIGatewayProxyStructuredResultV2 => ({
  body: JSON.stringify(body),
  headers: {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "x-correlation-id": correlationId,
  },
  isBase64Encoded: false,
  statusCode,
});

export const noContentResponse = (correlationId: string): APIGatewayProxyStructuredResultV2 => ({
  headers: {
    ...SECURITY_HEADERS,
    "x-correlation-id": correlationId,
  },
  isBase64Encoded: false,
  statusCode: 204,
});
