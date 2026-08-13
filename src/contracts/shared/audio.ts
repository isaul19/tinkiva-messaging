import { z } from "zod";

export const audioMimeTypeSchema = z.enum([
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
]);

export type AudioMimeType = z.infer<typeof audioMimeTypeSchema>;
