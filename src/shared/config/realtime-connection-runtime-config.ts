import { z } from "zod";

const realtimeConnectionRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
});

export type RealtimeConnectionRuntimeConfig = z.infer<typeof realtimeConnectionRuntimeConfigSchema>;

export const loadRealtimeConnectionRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): RealtimeConnectionRuntimeConfig => realtimeConnectionRuntimeConfigSchema.parse(environment);
