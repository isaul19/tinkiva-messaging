import { z } from "zod";

import { externalAccountIdSchema, tenantIdSchema } from "../shared/identifiers.js";

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ensureTenantRequestSchema = z
  .object({
    externalAccountCode: z.string().trim().min(1).max(100).optional(),
    externalAccountId: externalAccountIdSchema,
    metadata: z.record(z.string().min(1).max(100), metadataValueSchema).optional(),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const ensureTenantResponseSchema = z
  .object({
    externalAccountId: externalAccountIdSchema,
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    tenantId: tenantIdSchema,
  })
  .strict();

export type EnsureTenantRequest = z.infer<typeof ensureTenantRequestSchema>;
export type EnsureTenantResponse = z.infer<typeof ensureTenantResponseSchema>;
