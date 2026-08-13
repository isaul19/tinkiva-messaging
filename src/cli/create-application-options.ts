import { z } from "zod";

import { applicationScopeSchema, type ApplicationScope } from "../contracts/api/auth.contract.js";

const argumentsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[A-Z][A-Z0-9_]*$/),
  credentialsSecretName: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(200),
  region: z.string().min(1),
  scopes: z.array(applicationScopeSchema).min(1),
  stage: z.string().regex(/^[a-z][a-z0-9-]*$/),
});

const defaultScopes: ApplicationScope[] = [
  "events:manage",
  "integrations:read",
  "integrations:write",
  "messages:read",
  "messages:send",
  "tenants:read",
  "tenants:write",
];

export type CreateApplicationArguments = z.infer<typeof argumentsSchema>;

export interface CreateApplicationOutputInput {
  applicationId: string;
  clientId: string;
  clientSecret: string;
  credentialsSecretArn?: string;
  credentialsSecretName?: string;
  scopes: ApplicationScope[];
}

const readNamedArguments = (values: string[]): Record<string, string> => {
  const parsed: Record<string, string> = {};

  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];

    if (name === undefined || value === undefined || !name.startsWith("--")) {
      throw new Error("Arguments must use --name value pairs.");
    }

    parsed[name.slice(2)] = value;
  }

  return parsed;
};

export const parseCreateApplicationArguments = (values: string[]): CreateApplicationArguments => {
  const raw = readNamedArguments(values);
  const code = raw.code?.trim().toUpperCase();

  return argumentsSchema.parse({
    code,
    credentialsSecretName: raw["credentials-secret-name"],
    name: raw.name,
    region: raw.region ?? "us-east-1",
    scopes:
      raw.scopes === undefined ? defaultScopes : raw.scopes.split(",").map((scope) => scope.trim()),
    stage: raw.stage ?? "dev",
  });
};

export const createApplicationOutput = (
  input: CreateApplicationOutputInput,
): Record<string, unknown> => {
  const common = {
    applicationId: input.applicationId,
    clientId: input.clientId,
    scopes: input.scopes,
    status: "created",
  };

  if (input.credentialsSecretName !== undefined) {
    return {
      ...common,
      credentialDelivery: "SECRETS_MANAGER",
      credentialsSecretArn: input.credentialsSecretArn,
      credentialsSecretName: input.credentialsSecretName,
    };
  }

  return {
    ...common,
    clientSecret: input.clientSecret,
    credentialDelivery: "ONE_TIME_STDOUT",
    warning:
      "Save clientSecret now in the consumer's credential vault. Tinkiva Messaging stores only its digest and cannot recover it.",
  };
};
