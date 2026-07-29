import { z } from "zod";

import type { StoredOutgoingContent } from "../../application/ports/outgoing-message-store.js";

const storedContentSchema = z.discriminatedUnion("type", [
  z.looseObject({
    text: z.string(),
    type: z.literal("TEXT"),
  }),
  z.looseObject({
    caption: z.string().max(1_024).optional(),
    media: z.object({
      bucket: z.string().min(1),
      key: z.string().min(1),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      sizeBytes: z.number().int().positive(),
    }),
    type: z.literal("IMAGE"),
  }),
]);

export const readStoredMessageContent = (
  value: Record<string, unknown> | undefined,
): StoredOutgoingContent | undefined => {
  const parsed = storedContentSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.type === "TEXT") {
    return { text: parsed.data.text, type: "TEXT" };
  }
  return {
    ...(parsed.data.caption === undefined ? {} : { caption: parsed.data.caption }),
    media: parsed.data.media,
    type: "IMAGE",
  };
};
