import { z } from "zod";

const inboundProcessorRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  DATA_TABLE: z.string().min(1),
});

export type InboundProcessorRuntimeConfig = z.infer<typeof inboundProcessorRuntimeConfigSchema>;

export const loadInboundProcessorRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): InboundProcessorRuntimeConfig => inboundProcessorRuntimeConfigSchema.parse(environment);
