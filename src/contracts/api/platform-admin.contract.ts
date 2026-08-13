import { z } from "zod";

import { applicationIdSchema, integrationIdSchema, tenantIdSchema } from "../shared/identifiers.js";

export const inboundMediaConfigurationSchema = z.strictObject({
  audioAlternativeText: z.boolean(),
  imageAlternativeText: z.boolean(),
});

export const platformIntegrationListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(4_096).optional(),
});

export const openAiCredentialStatusSchema = z.discriminatedUnion("configured", [
  z.strictObject({ configured: z.literal(false), updatedAt: z.iso.datetime().optional() }),
  z.strictObject({
    configured: z.literal(true),
    credentialVersion: z.number().int().positive(),
    updatedAt: z.iso.datetime(),
  }),
]);

const openAiApiKeySchema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^\S+$/, "The OpenAI API key must not contain whitespace.");

export const putPlatformIntegrationOpenAiCredentialRequestSchema = z.strictObject({
  apiKey: openAiApiKeySchema,
  applicationId: applicationIdSchema,
  expectedCredentialVersion: z.number().int().positive().optional(),
  organization: z.string().trim().min(1).max(255).optional(),
  project: z.string().trim().min(1).max(255).optional(),
  tenantId: tenantIdSchema,
});

export const deletePlatformIntegrationOpenAiCredentialRequestSchema = z.strictObject({
  applicationId: applicationIdSchema,
  expectedCredentialVersion: z.number().int().positive(),
  tenantId: tenantIdSchema,
});

export const updatePlatformIntegrationInboundMediaRequestSchema = z.strictObject({
  applicationId: applicationIdSchema,
  inboundMedia: inboundMediaConfigurationSchema,
  tenantId: tenantIdSchema,
});

export const platformIntegrationDeletionRequestSchema = z.strictObject({
  applicationId: applicationIdSchema,
  confirmation: integrationIdSchema,
  mode: z.enum(["CHATS_ONLY", "INTEGRATION_AND_CHATS"]),
  tenantId: tenantIdSchema,
});

export type InboundMediaConfiguration = z.infer<typeof inboundMediaConfigurationSchema>;
export type OpenAICredentialStatus = z.infer<typeof openAiCredentialStatusSchema>;
export type PutPlatformIntegrationOpenAiCredentialRequest = z.infer<
  typeof putPlatformIntegrationOpenAiCredentialRequestSchema
>;
export type DeletePlatformIntegrationOpenAiCredentialRequest = z.infer<
  typeof deletePlatformIntegrationOpenAiCredentialRequestSchema
>;
export type PlatformIntegrationDeletionRequest = z.infer<
  typeof platformIntegrationDeletionRequestSchema
>;
export type UpdatePlatformIntegrationInboundMediaRequest = z.infer<
  typeof updatePlatformIntegrationInboundMediaRequestSchema
>;
