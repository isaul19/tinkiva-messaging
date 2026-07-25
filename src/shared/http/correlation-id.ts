import { ulid } from "ulid";

import { correlationIdSchema } from "../../contracts/shared/identifiers.js";

const CORRELATION_HEADER = "x-correlation-id";

export const resolveCorrelationId = (
  headers: Readonly<Record<string, string | undefined>>,
): string => {
  const providedValue = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === CORRELATION_HEADER,
  )?.[1];

  const parsedValue = correlationIdSchema.safeParse(providedValue);

  return parsedValue.success ? parsedValue.data : `cor_${ulid()}`;
};
