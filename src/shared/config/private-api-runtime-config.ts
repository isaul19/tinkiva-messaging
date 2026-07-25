import { z } from "zod";

const privateApiRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  STAGE: z.string().min(1),
  TELEGRAM_OUTBOUND_QUEUE_URL: z.string().min(1),
  TELEGRAM_WEBHOOK_BASE_URL: z.url(),
});

export type PrivateApiRuntimeConfig = z.infer<typeof privateApiRuntimeConfigSchema>;

export const loadPrivateApiRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): PrivateApiRuntimeConfig => privateApiRuntimeConfigSchema.parse(environment);
