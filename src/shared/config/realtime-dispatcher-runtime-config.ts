import { z } from "zod";

const realtimeDispatcherRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  WEBSOCKET_MANAGEMENT_ENDPOINT: z.url(),
});

export type RealtimeDispatcherRuntimeConfig = z.infer<typeof realtimeDispatcherRuntimeConfigSchema>;

export const loadRealtimeDispatcherRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): RealtimeDispatcherRuntimeConfig => realtimeDispatcherRuntimeConfigSchema.parse(environment);
