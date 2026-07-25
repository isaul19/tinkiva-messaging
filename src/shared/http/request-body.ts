import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { ApplicationError } from "../errors/application-error.js";

export const readJsonBody = (event: APIGatewayProxyEventV2): unknown => {
  if (event.body === undefined) {
    throw new ApplicationError("VALIDATION_ERROR", "A JSON request body is required.", 400);
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(body);
  } catch {
    throw new ApplicationError("VALIDATION_ERROR", "The request body must be valid JSON.", 400);
  }
};

export const readHeader = (
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined =>
  Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
  )?.[1];
