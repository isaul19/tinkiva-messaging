import { z } from "zod";

const whatsappSenderRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  MEDIA_BUCKET: z.string().min(1),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  STAGE: z.string().min(1),
});

export type WhatsappSenderRuntimeConfig = z.infer<typeof whatsappSenderRuntimeConfigSchema>;

export const loadWhatsappSenderRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): WhatsappSenderRuntimeConfig => whatsappSenderRuntimeConfigSchema.parse(environment);
