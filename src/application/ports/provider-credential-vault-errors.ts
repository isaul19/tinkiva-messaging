export class ProviderCredentialVersionConflictError extends Error {
  public constructor() {
    super("The provider credential version has changed.");
    this.name = "ProviderCredentialVersionConflictError";
  }
}
