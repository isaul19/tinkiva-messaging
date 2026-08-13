import { z } from "zod";

const mediaEnrichmentRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  MEDIA_BUCKET: z.string().min(1),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  OPENAI_AUDIO_MODEL: z.string().min(1).default("gpt-4o-mini-transcribe"),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-5.6-luna"),
  TINKIVA_INTEGRATIONS_TABLE: z.string().min(1),
  TINKIVA_KMS_KEY_ID: z.string().min(1),
  STAGE: z.string().min(1),
  STORAGIA_APPLICATION_ID: z.string().min(1),
});

export type MediaEnrichmentRuntimeConfig = z.infer<typeof mediaEnrichmentRuntimeConfigSchema>;

export const loadMediaEnrichmentRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): MediaEnrichmentRuntimeConfig => mediaEnrichmentRuntimeConfigSchema.parse(environment);
