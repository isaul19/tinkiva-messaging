import { z } from "zod";

const whatsappWebhookRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  INBOUND_QUEUE_URL: z.url(),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  STAGE: z.string().min(1),
});

export type WhatsappWebhookRuntimeConfig = z.infer<typeof whatsappWebhookRuntimeConfigSchema>;

export const loadWhatsappWebhookRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): WhatsappWebhookRuntimeConfig => whatsappWebhookRuntimeConfigSchema.parse(environment);
