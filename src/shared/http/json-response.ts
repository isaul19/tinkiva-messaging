import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
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
    "x-correlation-id": correlationId,
  },
  isBase64Encoded: false,
  statusCode,
});
