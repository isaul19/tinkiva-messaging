import { z } from "zod";

import { integrationIdSchema, tenantIdSchema } from "../shared/identifiers.js";

const metaIdSchema = z.string().trim().min(1).max(120).regex(/^\d+$/);

export const registerWhatsappIntegrationRequestSchema = z
  .object({
    accessToken: z.string().trim().min(20).max(4_096),
    appSecret: z.string().trim().min(16).max(500),
    businessPortfolioId: metaIdSchema.optional(),
    displayName: z.string().trim().min(1).max(160),
    metaAppId: metaIdSchema,
    phoneNumberId: metaIdSchema,
    wabaId: metaIdSchema,
  })
  .strict();

export const whatsappIntegrationResponseSchema = z
  .object({
    displayName: z.string().min(1),
    displayPhoneNumber: z.string().min(1).optional(),
    integrationId: integrationIdSchema,
    phoneNumberId: z.string().min(1),
    provider: z.literal("WHATSAPP"),
    status: z.enum(["ACTIVE", "ERROR", "PENDING"]),
    tenantId: tenantIdSchema,
    verifiedName: z.string().min(1).optional(),
    webhookUrl: z.url(),
  })
  .strict();

export type RegisterWhatsappIntegrationRequest = z.infer<
  typeof registerWhatsappIntegrationRequestSchema
>;
export type WhatsappIntegrationResponse = z.infer<typeof whatsappIntegrationResponseSchema>;
