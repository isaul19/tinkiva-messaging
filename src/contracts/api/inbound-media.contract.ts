import { z } from "zod";

export const DEFAULT_INBOUND_MEDIA_SETTINGS = {
  audioAlternativeText: false,
  imageAlternativeText: false,
} as const;

export const inboundMediaSettingsSchema = z
  .object({
    audioAlternativeText: z.boolean().default(false),
    imageAlternativeText: z.boolean().default(false),
  })
  .strict()
  .default(DEFAULT_INBOUND_MEDIA_SETTINGS);

export type InboundMediaSettings = z.infer<typeof inboundMediaSettingsSchema>;
