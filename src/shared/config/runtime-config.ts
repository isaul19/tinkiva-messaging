import { z } from "zod";

const baseRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
});

const tokenRuntimeConfigSchema = baseRuntimeConfigSchema.extend({
  AUTH_PEPPER_SECRET_ARN: z.string().min(1),
  JWT_SIGNING_SECRET_ARN: z.string().min(1),
  TOKEN_AUDIENCE: z.string().min(1),
  TOKEN_ISSUER: z.url(),
  TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600),
});

export type BaseRuntimeConfig = z.infer<typeof baseRuntimeConfigSchema>;
export type TokenRuntimeConfig = z.infer<typeof tokenRuntimeConfigSchema>;

export const loadBaseRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): BaseRuntimeConfig => baseRuntimeConfigSchema.parse(environment);

export const loadTokenRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): TokenRuntimeConfig => tokenRuntimeConfigSchema.parse(environment);
