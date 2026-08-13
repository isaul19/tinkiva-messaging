import { z } from "zod";

import { integrationIdSchema, tenantIdSchema } from "../shared/identifiers.js";
import { inboundMediaSettingsSchema } from "./inbound-media.contract.js";

const metaIdSchema = z.string().trim().min(1).max(120).regex(/^\d+$/);

export const registerWhatsappIntegrationRequestSchema = z
  .object({
    accessToken: z.string().trim().min(20).max(4_096),
    appSecret: z.string().trim().min(16).max(500),
    businessPortfolioId: metaIdSchema.optional(),
    displayName: z.string().trim().min(1).max(160),
    inboundMedia: inboundMediaSettingsSchema,
    metaAppId: metaIdSchema,
    phoneNumberId: metaIdSchema,
    wabaId: metaIdSchema,
  })
  .strict();

export const rotateWhatsappCredentialRequestSchema = z
  .object({
    accessToken: z.string().trim().min(20).max(4_096),
    expectedCredentialVersion: z.number().int().positive(),
  })
  .strict();

export const rotateWhatsappCredentialResponseSchema = z
  .object({
    credentialVersion: z.number().int().positive(),
    integrationId: integrationIdSchema,
    provider: z.literal("WHATSAPP"),
    status: z.literal("ACTIVE"),
    tenantId: tenantIdSchema,
    tokenDataAccessExpiresAt: z.iso.datetime().optional(),
    tokenExpiresAt: z.iso.datetime().optional(),
    tokenType: z.string().min(1).optional(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const whatsappIntegrationResponseSchema = z
  .object({
    credentialVersion: z.number().int().positive(),
    displayName: z.string().min(1),
    displayPhoneNumber: z.string().min(1).optional(),
    inboundMedia: inboundMediaSettingsSchema,
    integrationId: integrationIdSchema,
    phoneNumberId: z.string().min(1),
    provider: z.literal("WHATSAPP"),
    status: z.enum(["ACTIVE", "ERROR", "PENDING"]),
    tenantId: tenantIdSchema,
    verifiedName: z.string().min(1).optional(),
    webhookUrl: z.url(),
  })
  .strict();

export type RotateWhatsappCredentialRequest = z.infer<typeof rotateWhatsappCredentialRequestSchema>;
export type RotateWhatsappCredentialResponse = z.infer<
  typeof rotateWhatsappCredentialResponseSchema
>;
export type RegisterWhatsappIntegrationRequest = z.input<
  typeof registerWhatsappIntegrationRequestSchema
>;
export type WhatsappIntegrationResponse = z.infer<typeof whatsappIntegrationResponseSchema>;
