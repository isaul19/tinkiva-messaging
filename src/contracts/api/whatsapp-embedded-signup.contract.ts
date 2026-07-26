import { z } from "zod";

import { whatsappIntegrationResponseSchema } from "./whatsapp-integration.contract.js";

const metaIdSchema = z.string().trim().min(1).max(120).regex(/^\d+$/);

export const whatsappEmbeddedSignupConfigurationResponseSchema = z
  .object({
    appId: metaIdSchema.optional(),
    configurationId: metaIdSchema.optional(),
    configured: z.boolean(),
    graphApiVersion: z.string().regex(/^v\d+\.\d+$/),
  })
  .strict();

export const completeWhatsappEmbeddedSignupRequestSchema = z
  .object({
    authorizationCode: z.string().trim().min(10).max(4_096),
    businessPortfolioId: metaIdSchema.optional(),
    displayName: z.string().trim().min(1).max(160),
    phoneNumberId: metaIdSchema,
    wabaId: metaIdSchema,
  })
  .strict();

export const completeWhatsappEmbeddedSignupResponseSchema = whatsappIntegrationResponseSchema;

export type CompleteWhatsappEmbeddedSignupRequest = z.infer<
  typeof completeWhatsappEmbeddedSignupRequestSchema
>;
export type CompleteWhatsappEmbeddedSignupResponse = z.infer<
  typeof completeWhatsappEmbeddedSignupResponseSchema
>;
export type WhatsappEmbeddedSignupConfigurationResponse = z.infer<
  typeof whatsappEmbeddedSignupConfigurationResponseSchema
>;
