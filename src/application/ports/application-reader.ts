export const APPLICATION_SCOPES = [
  "events:manage",
  "integrations:read",
  "integrations:write",
  "messages:read",
  "messages:send",
  "platform:admin",
  "tenants:read",
  "tenants:write",
] as const;

export type ApplicationScope = (typeof APPLICATION_SCOPES)[number];

export interface ApplicationRecord {
  applicationId: string;
  code: string;
  name: string;
  status: "ACTIVE" | "DISABLED";
}

export interface ApplicationClientRecord {
  applicationId: string;
  clientId: string;
  scopes: ApplicationScope[];
  secretDigest: string;
  status: "ACTIVE" | "REVOKED";
}

export interface ApplicationReader {
  getApplication(applicationId: string): Promise<ApplicationRecord | undefined>;
  getClient(clientId: string): Promise<ApplicationClientRecord | undefined>;
}
