import { z } from "zod";

const platformAdminRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  MEDIA_BUCKET: z.string().min(1),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  TINKIVA_INTEGRATIONS_TABLE: z.string().min(1),
  STAGE: z.string().min(1),
});

export type PlatformAdminRuntimeConfig = z.infer<typeof platformAdminRuntimeConfigSchema>;

export const loadPlatformAdminRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): PlatformAdminRuntimeConfig => platformAdminRuntimeConfigSchema.parse(environment);
