import { z } from "zod";

import { correlationIdSchema } from "../shared/identifiers.js";

export const publicErrorCodeSchema = z.enum([
  "ADMIN_CONFIRMATION_INVALID",
  "ADMIN_ROUTE_NOT_FOUND",
  "AUTH_INVALID_CLIENT",
  "AUTH_CLIENT_DISABLED",
  "AUTH_INVALID_TOKEN",
  "AUTH_SCOPE_MISSING",
  "TENANT_NOT_FOUND",
  "TENANT_ACCESS_DENIED",
  "INTEGRATION_NOT_FOUND",
  "INTEGRATION_DISABLED",
  "OPENAI_CREDENTIAL_REQUIRED",
  "OPENAI_CREDENTIAL_VERSION_CONFLICT",
  "PROVIDER_CREDENTIAL_INVALID",
  "PROVIDER_CREDENTIAL_VERSION_CONFLICT",
  "PROVIDER_CONFIGURATION_INVALID",
  "PROVIDER_REJECTED_MESSAGE",
  "RECIPIENT_INVALID",
  "CONVERSATION_NOT_FOUND",
  "PAGINATION_CURSOR_INVALID",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "MESSAGE_NOT_SENDABLE",
  "MEDIA_INVALID",
  "WEBHOOK_NOT_FOUND",
  "WEBHOOK_SIGNATURE_INVALID",
  "WEBHOOK_VERIFICATION_INVALID",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
]);

export const publicErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: publicErrorCodeSchema,
        correlationId: correlationIdSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type PublicErrorCode = z.infer<typeof publicErrorCodeSchema>;
export type PublicErrorResponse = z.infer<typeof publicErrorResponseSchema>;
