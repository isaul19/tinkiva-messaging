import { z } from "zod";

import {
  applicationIdSchema,
  conversationIdSchema,
  integrationIdSchema,
  messageIdSchema,
  tenantIdSchema,
} from "../shared/identifiers.js";
import { audioMimeTypeSchema } from "../shared/audio.js";

const mediaReferenceSchema = z
  .object({
    bucket: z.string().min(1).max(63),
    key: z.string().min(1).max(1_024),
    mimeType: z.string().min(1).max(255),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

const commonJobFields = {
  applicationId: applicationIdSchema,
  caption: z.string().trim().min(1).max(1_024).optional(),
  conversationId: conversationIdSchema,
  integrationId: integrationIdSchema,
  messageId: messageIdSchema,
  messageSortKey: z.string().min(1).max(512).startsWith("MESSAGE#"),
  tenantId: tenantIdSchema,
};

export const imageMediaEnrichmentJobSchema = z
  .object({
    ...commonJobFields,
    media: mediaReferenceSchema.extend({
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    }),
    type: z.literal("IMAGE"),
  })
  .strict();

export const audioMediaEnrichmentJobSchema = z
  .object({
    ...commonJobFields,
    media: mediaReferenceSchema.extend({ mimeType: audioMimeTypeSchema }),
    type: z.literal("AUDIO"),
  })
  .strict();

export const mediaEnrichmentJobSchema = z.discriminatedUnion("type", [
  imageMediaEnrichmentJobSchema,
  audioMediaEnrichmentJobSchema,
]);

export type AudioMediaEnrichmentJob = z.infer<typeof audioMediaEnrichmentJobSchema>;
export type ImageMediaEnrichmentJob = z.infer<typeof imageMediaEnrichmentJobSchema>;
export type MediaEnrichmentJob = z.infer<typeof mediaEnrichmentJobSchema>;
