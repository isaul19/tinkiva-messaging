export interface OpenAICredentialScope {
  applicationId: string;
  integrationId: string;
  tenantId: string;
}

export interface OpenAICredential {
  apiKey: string;
  organization?: string;
  project?: string;
}

export interface OpenAICredentialStatus {
  configured: boolean;
  credentialVersion?: number;
  updatedAt?: string;
}

export interface UpsertOpenAICredentialInput extends OpenAICredentialScope, OpenAICredential {
  /** Omit only when creating a credential for the first time. */
  expectedCredentialVersion?: number;
}

export interface DeleteOpenAICredentialInput extends OpenAICredentialScope {
  expectedCredentialVersion: number;
}

export class OpenAICredentialVersionConflictError extends Error {
  public constructor() {
    super("The OpenAI credential changed or no longer exists.");
    this.name = "OpenAICredentialVersionConflictError";
  }
}

export class OpenAICredentialUnavailableError extends Error {
  public constructor() {
    super("The OpenAI credential is unavailable.");
    this.name = "OpenAICredentialUnavailableError";
  }
}

export interface OpenAICredentialReader {
  get(scope: OpenAICredentialScope): Promise<OpenAICredential>;
  status(scope: OpenAICredentialScope): Promise<OpenAICredentialStatus>;
  batchStatus(scopes: readonly OpenAICredentialScope[]): Promise<OpenAICredentialStatus[]>;
}

export interface OpenAICredentialWriter {
  upsert(input: UpsertOpenAICredentialInput): Promise<OpenAICredentialStatus>;
  delete(input: DeleteOpenAICredentialInput): Promise<OpenAICredentialStatus>;
}

export type OpenAICredentialVault = OpenAICredentialReader & OpenAICredentialWriter;
