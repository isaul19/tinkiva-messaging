import { z } from "zod";

const appEventProjectorRuntimeConfigSchema = z.object({
  APP_EVENTS_QUEUE_URL: z.url(),
  MEDIA_BUCKET: z.string().min(1),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
});

export type AppEventProjectorRuntimeConfig = z.infer<typeof appEventProjectorRuntimeConfigSchema>;

export const loadAppEventProjectorRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): AppEventProjectorRuntimeConfig => appEventProjectorRuntimeConfigSchema.parse(environment);
