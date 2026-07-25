import { z } from "zod";

export const applicationScopeSchema = z.enum([
  "events:manage",
  "integrations:read",
  "integrations:write",
  "messages:read",
  "messages:send",
  "platform:admin",
  "tenants:read",
  "tenants:write",
]);

export const issueTokenRequestSchema = z.strictObject({
  clientId: z
    .string()
    .trim()
    .min(6)
    .max(120)
    .regex(/^msgc_[0-9A-Za-z_-]+$/),
  clientSecret: z
    .string()
    .min(32)
    .max(500)
    .regex(/^msgs_[0-9A-Za-z_-]+$/),
});

export const issueTokenResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  tokenType: z.literal("Bearer"),
});

export const accessTokenClaimsSchema = z.looseObject({
  aud: z.union([z.string(), z.array(z.string())]),
  client_id: z.string().min(1),
  exp: z.number().int().positive(),
  iat: z.number().int().positive(),
  iss: z.url(),
  jti: z.string().min(1),
  scope: z.string(),
  sub: z.string().min(1),
});

export const tokenRequestSchema = issueTokenRequestSchema;
export const tokenResponseSchema = issueTokenResponseSchema;

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
export type ApplicationScope = z.infer<typeof applicationScopeSchema>;
export type IssueTokenRequest = z.infer<typeof issueTokenRequestSchema>;
export type IssueTokenResponse = z.infer<typeof issueTokenResponseSchema>;
export type TokenRequest = IssueTokenRequest;
export type TokenResponse = IssueTokenResponse;
