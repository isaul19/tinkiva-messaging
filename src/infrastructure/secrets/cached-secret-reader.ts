import { GetSecretValueCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { z } from "zod";

import type { SecretReader } from "../../application/ports/secret-reader.js";

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export class CachedSecretReader implements SecretReader {
  readonly #cache = new Map<string, CacheEntry>();
  readonly #client: SecretsManagerClient;
  readonly #ttlMs: number;

  public constructor(client: SecretsManagerClient, ttlMs = 300_000) {
    this.#client = client;
    this.#ttlMs = ttlMs;
  }

  public async getJson<TSchema extends z.ZodType>(
    secretId: string,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const now = Date.now();
    const cached = this.#cache.get(secretId);

    if (cached !== undefined && cached.expiresAt > now) {
      return schema.parse(cached.value);
    }

    const response = await this.#client.send(
      new GetSecretValueCommand({
        SecretId: secretId,
        VersionStage: "AWSCURRENT",
      }),
    );

    if (response.SecretString === undefined) {
      throw new Error(`Secret ${secretId} does not contain a string value.`);
    }

    const parsedJson: unknown = JSON.parse(response.SecretString);
    const value = schema.parse(parsedJson);

    this.#cache.set(secretId, {
      expiresAt: now + this.#ttlMs,
      value,
    });

    return value;
  }
}
