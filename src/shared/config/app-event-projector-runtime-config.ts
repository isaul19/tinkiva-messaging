import { z } from "zod";

const appEventProjectorRuntimeConfigSchema = z.object({
  APP_EVENTS_QUEUE_URL: z.url(),
});

export type AppEventProjectorRuntimeConfig = z.infer<typeof appEventProjectorRuntimeConfigSchema>;

export const loadAppEventProjectorRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): AppEventProjectorRuntimeConfig => appEventProjectorRuntimeConfigSchema.parse(environment);
