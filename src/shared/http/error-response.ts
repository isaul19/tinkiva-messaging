import { ZodError } from "zod";

import { ApplicationError } from "../errors/application-error.js";
import { jsonResponse } from "./json-response.js";

export const errorResponse = (error: unknown, correlationId: string) => {
  if (error instanceof ApplicationError) {
    return jsonResponse(
      error.statusCode,
      {
        error: {
          code: error.code,
          correlationId,
          message: error.message,
          retryable: error.retryable,
        },
      },
      correlationId,
    );
  }

  if (error instanceof ZodError) {
    return jsonResponse(
      400,
      {
        error: {
          code: "VALIDATION_ERROR",
          correlationId,
          message: "The request is invalid.",
          retryable: false,
        },
      },
      correlationId,
    );
  }

  return jsonResponse(
    500,
    {
      error: {
        code: "INTERNAL_ERROR",
        correlationId,
        message: "An internal error occurred.",
        retryable: true,
      },
    },
    correlationId,
  );
};
