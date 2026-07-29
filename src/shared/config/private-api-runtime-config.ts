import { z } from "zod";

const privateApiRuntimeConfigSchema = z.object({
  CONTROL_TABLE: z.string().min(1),
  PROVIDER_CREDENTIALS_KEY_ARN: z.string().min(1),
  DATA_TABLE: z.string().min(1),
  MEDIA_BUCKET: z.string().min(1),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(300),
  REALTIME_TICKET_TTL_SECONDS: z.coerce.number().int().min(30).max(300),
  REALTIME_WEBSOCKET_URL: z.url().refine((value) => value.startsWith("wss://")),
  STAGE: z.string().min(1),
  TELEGRAM_OUTBOUND_QUEUE_URL: z.string().min(1),
  TELEGRAM_WEBHOOK_BASE_URL: z.url(),
  WHATSAPP_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/),
  WHATSAPP_OUTBOUND_QUEUE_URL: z.string().min(1),
  WHATSAPP_WEBHOOK_BASE_URL: z.url(),
});

export type PrivateApiRuntimeConfig = z.infer<typeof privateApiRuntimeConfigSchema>;

export const loadPrivateApiRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): PrivateApiRuntimeConfig => privateApiRuntimeConfigSchema.parse(environment);
