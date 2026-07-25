import { z } from "zod";

const opaqueIdentifier = (prefix: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(
      new RegExp(`^${prefix}_[0-9A-Za-z_-]+$`),
      `Expected an opaque identifier with prefix "${prefix}_".`,
    );

export const applicationIdSchema = opaqueIdentifier("app");
export const conversationIdSchema = opaqueIdentifier("conv");
export const eventIdSchema = opaqueIdentifier("evt");
export const integrationIdSchema = opaqueIdentifier("int");
export const messageIdSchema = opaqueIdentifier("msg");
export const tenantIdSchema = opaqueIdentifier("tenant");

export const correlationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[0-9A-Za-z._:-]+$/);

export const externalAccountIdSchema = z.string().trim().min(1).max(255);
