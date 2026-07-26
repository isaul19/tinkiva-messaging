import { z } from "zod";

const whatsappSenderRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  STAGE: z.string().min(1),
});

export type WhatsappSenderRuntimeConfig = z.infer<typeof whatsappSenderRuntimeConfigSchema>;

export const loadWhatsappSenderRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): WhatsappSenderRuntimeConfig => whatsappSenderRuntimeConfigSchema.parse(environment);
