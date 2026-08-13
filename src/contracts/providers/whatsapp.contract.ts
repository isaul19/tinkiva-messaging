import { z } from "zod";

import { latitudeSchema, longitudeSchema } from "../shared/location.js";

export const whatsappCredentialSchema = z.strictObject({
  accessToken: z.string().min(20).max(4_096),
  appSecret: z.string().min(16).max(500),
  verifyToken: z.string().min(32).max(255),
});

export const whatsappContactSchema = z.looseObject({
  bsuid: z.string().min(1).optional(),
  profile: z
    .looseObject({
      name: z.string().min(1).optional(),
    })
    .optional(),
  user_id: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  wa_id: z.string().min(1).optional(),
});

export const whatsappMessageSchema = z.looseObject({
  audio: z
    .looseObject({
      id: z.string().min(1),
      mime_type: z.string().min(1).optional(),
      sha256: z.string().min(1).optional(),
      voice: z.boolean().optional(),
    })
    .optional(),
  from: z.string().min(1),
  id: z.string().min(1),
  image: z
    .looseObject({
      caption: z.string().max(1_024).optional(),
      id: z.string().min(1),
      mime_type: z.string().min(1).optional(),
      sha256: z.string().min(1).optional(),
    })
    .optional(),
  location: z
    .looseObject({
      address: z.string().optional(),
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      name: z.string().optional(),
    })
    .optional(),
  text: z
    .looseObject({
      body: z.string().min(1),
    })
    .optional(),
  timestamp: z.string().regex(/^\d+$/),
  type: z.string().min(1),
});

export const whatsappStatusSchema = z.looseObject({
  errors: z
    .array(
      z.looseObject({
        code: z.number().int().optional(),
        message: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .optional(),
  id: z.string().min(1),
  recipient_id: z.string().min(1),
  status: z.enum(["delivered", "failed", "read", "sent"]),
  timestamp: z.string().regex(/^\d+$/),
});

const whatsappChangeValueSchema = z.looseObject({
  contacts: z.array(whatsappContactSchema).optional(),
  messages: z.array(whatsappMessageSchema).optional(),
  messaging_product: z.literal("whatsapp"),
  metadata: z.looseObject({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().min(1),
  }),
  statuses: z.array(whatsappStatusSchema).optional(),
});

export const whatsappWebhookPayloadSchema = z.looseObject({
  entry: z.array(
    z.looseObject({
      changes: z.array(
        z.looseObject({
          field: z.literal("messages"),
          value: whatsappChangeValueSchema,
        }),
      ),
      id: z.string().min(1),
    }),
  ),
  object: z.literal("whatsapp_business_account"),
});

export type WhatsappContact = z.infer<typeof whatsappContactSchema>;
export type WhatsappCredential = z.infer<typeof whatsappCredentialSchema>;
export type WhatsappMessage = z.infer<typeof whatsappMessageSchema>;
export type WhatsappStatus = z.infer<typeof whatsappStatusSchema>;
export type WhatsappWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;
