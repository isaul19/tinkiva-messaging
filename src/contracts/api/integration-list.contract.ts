import { z } from "zod";

import { integrationIdSchema, tenantIdSchema } from "../shared/identifiers.js";

const integrationStatusSchema = z.enum(["ACTIVE", "DISABLED", "ERROR", "PENDING"]);

export const telegramIntegrationListItemSchema = z
  .object({
    botId: z.string().min(1),
    botUsername: z.string().min(1).optional(),
    createdAt: z.iso.datetime(),
    credentialVersion: z.number().int().positive(),
    displayName: z.string().min(1),
    integrationId: integrationIdSchema,
    provider: z.literal("TELEGRAM"),
    providerAccountId: z.string().min(1),
    status: integrationStatusSchema,
    tenantId: tenantIdSchema,
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();

export const whatsappIntegrationListItemSchema = z
  .object({
    createdAt: z.iso.datetime(),
    credentialVersion: z.number().int().positive(),
    displayName: z.string().min(1),
    displayPhoneNumber: z.string().min(1).optional(),
    integrationId: integrationIdSchema,
    phoneNumberId: z.string().min(1),
    provider: z.literal("WHATSAPP"),
    providerAccountId: z.string().min(1),
    status: integrationStatusSchema,
    tenantId: tenantIdSchema,
    updatedAt: z.iso.datetime().optional(),
    verifiedName: z.string().min(1).optional(),
  })
  .strict();

export const tenantIntegrationListItemSchema = z.discriminatedUnion("provider", [
  telegramIntegrationListItemSchema,
  whatsappIntegrationListItemSchema,
]);

export const listTenantIntegrationsResponseSchema = z
  .object({
    items: z.array(tenantIntegrationListItemSchema),
    tenantId: tenantIdSchema,
  })
  .strict();

export type ListTenantIntegrationsResponse = z.infer<typeof listTenantIntegrationsResponseSchema>;
export type TenantIntegrationListItem = z.infer<typeof tenantIntegrationListItemSchema>;
