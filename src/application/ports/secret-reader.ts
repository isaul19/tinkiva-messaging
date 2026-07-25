import type { z } from "zod";

export interface SecretReader {
  getJson<TSchema extends z.ZodType>(secretId: string, schema: TSchema): Promise<z.infer<TSchema>>;
}
