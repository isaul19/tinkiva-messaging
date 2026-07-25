import { z } from "zod";

import { integrationIdSchema, tenantIdSchema } from "../shared/identifiers.js";

export const registerTelegramIntegrationRequestSchema = z
  .object({
    botToken: z.string().trim().min(20).max(255),
    displayName: z.string().trim().min(1).max(160),
    dropPendingUpdates: z.boolean().optional(),
  })
  .strict();

export const telegramIntegrationResponseSchema = z
  .object({
    botId: z.string().min(1),
    botUsername: z.string().min(1).optional(),
    displayName: z.string().min(1),
    integrationId: integrationIdSchema,
    provider: z.literal("TELEGRAM"),
    status: z.enum(["ACTIVE", "ERROR", "PENDING"]),
    tenantId: tenantIdSchema,
    webhookUrl: z.url(),
  })
  .strict();

export type RegisterTelegramIntegrationRequest = z.infer<
  typeof registerTelegramIntegrationRequestSchema
>;
export type TelegramIntegrationResponse = z.infer<typeof telegramIntegrationResponseSchema>;
