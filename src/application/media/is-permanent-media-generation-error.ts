const PERMANENT_HTTP_STATUSES = new Set([400, 401, 403, 404, 413, 422]);
const PERMANENT_ERROR_NAMES = new Set([
  "AuthenticationError",
  "BadRequestError",
  "NotFoundError",
  "PermissionDeniedError",
  "UnprocessableEntityError",
  "OpenAICredentialUnavailableError",
]);

export const isPermanentMediaGenerationError = (error: unknown): boolean => {
  if (error instanceof RangeError) return true;
  if (!(error instanceof Error)) return false;

  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  return (
    PERMANENT_ERROR_NAMES.has(error.name) ||
    (status !== undefined && PERMANENT_HTTP_STATUSES.has(status))
  );
};
