import { z } from "zod";

const telegramSenderRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
});

export type TelegramSenderRuntimeConfig = z.infer<typeof telegramSenderRuntimeConfigSchema>;

export const loadTelegramSenderRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): TelegramSenderRuntimeConfig => telegramSenderRuntimeConfigSchema.parse(environment);
