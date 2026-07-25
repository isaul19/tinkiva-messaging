import { z } from "zod";

const telegramSenderRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  STAGE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
});

export type TelegramSenderRuntimeConfig = z.infer<typeof telegramSenderRuntimeConfigSchema>;

export const loadTelegramSenderRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): TelegramSenderRuntimeConfig => telegramSenderRuntimeConfigSchema.parse(environment);
