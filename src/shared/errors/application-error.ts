import type { PublicErrorCode } from "../../contracts/api/error.contract.js";

export class ApplicationError extends Error {
  public readonly code: PublicErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode: number;

  public constructor(
    code: PublicErrorCode,
    message: string,
    statusCode: number,
    retryable = false,
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}
