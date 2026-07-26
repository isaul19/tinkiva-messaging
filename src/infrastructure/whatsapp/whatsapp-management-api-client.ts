import { z } from "zod";

import type {
  WhatsappManagementApi,
  WhatsappPhoneNumber,
} from "../../application/ports/whatsapp-management-api.js";
import { ApplicationError } from "../../shared/errors/application-error.js";

const phoneNumbersResponseSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      display_phone_number: z.string().optional(),
      id: z.string().min(1),
      quality_rating: z.string().optional(),
      verified_name: z.string().optional(),
    }),
  ),
});

const subscribeResponseSchema = z.union([
  z.looseObject({
    success: z.union([z.boolean(), z.literal("true")]),
  }),
  z.looseObject({
    data: z.array(z.unknown()).min(1),
  }),
]);

export class WhatsappManagementApiClient implements WhatsappManagementApi {
  readonly #fetch: typeof globalThis.fetch;

  public constructor(fetchImplementation: typeof globalThis.fetch = globalThis.fetch) {
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  public async getPhoneNumbers(input: {
    accessToken: string;
    graphApiVersion: string;
    wabaId: string;
  }): Promise<WhatsappPhoneNumber[]> {
    try {
      const url = new URL(
        `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.wabaId)}/phone_numbers`,
      );
      url.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating");
      const response = await this.#fetch(url, {
        headers: {
          authorization: `Bearer ${input.accessToken}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(8_000),
      });
      const body: unknown = await response.json();
      const parsed = phoneNumbersResponseSchema.safeParse(body);

      if (!response.ok || !parsed.success) {
        if ([400, 401, 403].includes(response.status)) {
          throw invalidCredentialError();
        }

        throw providerUnavailableError();
      }

      return parsed.data.data.map((phone) => ({
        ...(phone.display_phone_number === undefined
          ? {}
          : { displayPhoneNumber: phone.display_phone_number }),
        id: phone.id,
        ...(phone.quality_rating === undefined ? {} : { qualityRating: phone.quality_rating }),
        ...(phone.verified_name === undefined ? {} : { verifiedName: phone.verified_name }),
      }));
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw providerUnavailableError();
    }
  }

  public async subscribeWaba(input: {
    accessToken: string;
    callbackUrl: string;
    graphApiVersion: string;
    verifyToken: string;
    wabaId: string;
  }): Promise<void> {
    try {
      const endpoint = `https://graph.facebook.com/${input.graphApiVersion}/${encodeURIComponent(input.wabaId)}/subscribed_apps`;
      const headers = {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      };
      const baseResponse = await this.#fetch(endpoint, {
        headers,
        method: "POST",
        signal: AbortSignal.timeout(8_000),
      });
      await assertSuccessfulSubscriptionResponse(baseResponse);

      const overrideResponse = await this.#fetch(endpoint, {
        body: JSON.stringify({
          override_callback_uri: input.callbackUrl,
          verify_token: input.verifyToken,
        }),
        headers,
        method: "POST",
        signal: AbortSignal.timeout(8_000),
      });
      await assertSuccessfulSubscriptionResponse(overrideResponse);
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }

      throw providerUnavailableError();
    }
  }
}

const assertSuccessfulSubscriptionResponse = async (response: Response): Promise<void> => {
  const body: unknown = await response.json();
  const parsed = subscribeResponseSchema.safeParse(body);
  const explicitlyRejected =
    parsed.success && "success" in parsed.data && parsed.data.success === false;

  if (!response.ok || !parsed.success || explicitlyRejected) {
    if ([400, 401, 403].includes(response.status) || explicitlyRejected) {
      throw new ApplicationError(
        "PROVIDER_CONFIGURATION_INVALID",
        "Meta rejected the WhatsApp webhook subscription.",
        400,
      );
    }

    throw providerUnavailableError();
  }
};

const invalidCredentialError = (): ApplicationError =>
  new ApplicationError(
    "PROVIDER_CREDENTIAL_INVALID",
    "The WhatsApp credential cannot access the requested WABA and phone number.",
    400,
  );

const providerUnavailableError = (): ApplicationError =>
  new ApplicationError(
    "PROVIDER_UNAVAILABLE",
    "Meta Graph API is temporarily unavailable.",
    503,
    true,
  );
