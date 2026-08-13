import { z } from "zod";

import { integrationIdSchema, tenantIdSchema } from "../shared/identifiers.js";
import { inboundMediaSettingsSchema } from "./inbound-media.contract.js";

export const registerTelegramIntegrationRequestSchema = z
  .object({
    botToken: z.string().trim().min(20).max(255),
    displayName: z.string().trim().min(1).max(160),
    dropPendingUpdates: z.boolean().optional(),
    inboundMedia: inboundMediaSettingsSchema,
  })
  .strict();

export const telegramIntegrationResponseSchema = z
  .object({
    botId: z.string().min(1),
    botUsername: z.string().min(1).optional(),
    displayName: z.string().min(1),
    inboundMedia: inboundMediaSettingsSchema,
    integrationId: integrationIdSchema,
    provider: z.literal("TELEGRAM"),
    status: z.enum(["ACTIVE", "ERROR", "PENDING"]),
    tenantId: tenantIdSchema,
    webhookUrl: z.url(),
  })
  .strict();

export type RegisterTelegramIntegrationRequest = z.input<
  typeof registerTelegramIntegrationRequestSchema
>;
export type TelegramIntegrationResponse = z.infer<typeof telegramIntegrationResponseSchema>;
