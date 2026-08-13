import { z } from "zod";

import { latitudeSchema, longitudeSchema } from "../shared/location.js";

const telegramUserSchema = z.looseObject({
  first_name: z.string().min(1),
  id: z.number().int(),
  is_bot: z.boolean(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

const telegramChatSchema = z.looseObject({
  first_name: z.string().optional(),
  id: z.number().int(),
  last_name: z.string().optional(),
  title: z.string().optional(),
  type: z.enum(["channel", "group", "private", "supergroup"]),
  username: z.string().optional(),
});

const telegramPhotoSizeSchema = z.looseObject({
  file_id: z.string().min(1),
  file_size: z.number().int().nonnegative().optional(),
  file_unique_id: z.string().min(1),
  height: z.number().int().positive(),
  width: z.number().int().positive(),
});

const telegramFileSchema = z.looseObject({
  file_id: z.string().min(1),
  file_name: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
  file_unique_id: z.string().min(1),
  mime_type: z.string().optional(),
});

const telegramAudioSchema = telegramFileSchema.extend({
  duration: z.number().int().nonnegative(),
});

const telegramLocationSchema = z.looseObject({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export const telegramMessageSchema = z.looseObject({
  audio: telegramAudioSchema.optional(),
  caption: z.string().max(1_024).optional(),
  chat: telegramChatSchema,
  date: z.number().int().nonnegative(),
  document: telegramFileSchema.optional(),
  from: telegramUserSchema.optional(),
  location: telegramLocationSchema.optional(),
  message_id: z.number().int().positive(),
  photo: z.array(telegramPhotoSizeSchema).min(1).optional(),
  text: z.string().max(4_096).optional(),
  video: telegramFileSchema.optional(),
  voice: telegramAudioSchema.optional(),
});

export const telegramCallbackQuerySchema = z.looseObject({
  data: z.string().optional(),
  from: telegramUserSchema,
  id: z.string().min(1),
  message: telegramMessageSchema.optional(),
});

export const telegramUpdateSchema = z.looseObject({
  callback_query: telegramCallbackQuerySchema.optional(),
  edited_message: telegramMessageSchema.optional(),
  message: telegramMessageSchema.optional(),
  update_id: z.number().int().nonnegative(),
});

export const telegramSecretSchema = z.strictObject({
  botToken: z.string().min(20),
  webhookSecretToken: z.string().min(32),
});

export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;
