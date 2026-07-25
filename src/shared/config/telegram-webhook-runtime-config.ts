import { z } from "zod";

const telegramWebhookRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  INBOUND_QUEUE_URL: z.url(),
});

export type TelegramWebhookRuntimeConfig = z.infer<typeof telegramWebhookRuntimeConfigSchema>;

export const loadTelegramWebhookRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): TelegramWebhookRuntimeConfig => telegramWebhookRuntimeConfigSchema.parse(environment);
