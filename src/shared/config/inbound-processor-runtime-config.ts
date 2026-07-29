import { z } from "zod";

const inboundProcessorRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  MEDIA_BUCKET: z.string().min(1),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  STAGE: z.string().min(1),
});

export type InboundProcessorRuntimeConfig = z.infer<typeof inboundProcessorRuntimeConfigSchema>;

export const loadInboundProcessorRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): InboundProcessorRuntimeConfig => inboundProcessorRuntimeConfigSchema.parse(environment);
