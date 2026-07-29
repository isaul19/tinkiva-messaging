import { tokenResponseSchema, type TokenResponse } from "../contracts/api/auth.contract.js";
import {
  conversationListQuerySchema,
  conversationMessageListQuerySchema,
  listConversationMessagesResponseSchema,
  listConversationsResponseSchema,
  type ListConversationMessagesResponse,
  type ListConversationsResponse,
} from "../contracts/api/conversation.contract.js";
import { publicErrorResponseSchema } from "../contracts/api/error.contract.js";
import {
  realtimeTicketResponseSchema,
  type RealtimeTicketResponse,
} from "../contracts/api/realtime.contract.js";
import {
  completeWhatsappEmbeddedSignupRequestSchema,
  completeWhatsappEmbeddedSignupResponseSchema,
  whatsappEmbeddedSignupConfigurationResponseSchema,
  type CompleteWhatsappEmbeddedSignupRequest,
  type CompleteWhatsappEmbeddedSignupResponse,
  type WhatsappEmbeddedSignupConfigurationResponse,
} from "../contracts/api/whatsapp-embedded-signup.contract.js";
import {
  sendMessageRequestSchema,
  sendMessageResponseSchema,
  type SendMessageRequest,
  type SendMessageResponse,
} from "../contracts/api/message.contract.js";
import {
  ensureTenantRequestSchema,
  ensureTenantResponseSchema,
  type EnsureTenantRequest,
  type EnsureTenantResponse,
} from "../contracts/api/tenant.contract.js";
import { conversationIdSchema, tenantIdSchema } from "../contracts/shared/identifiers.js";

export interface MessagingGatewayClientConfig {
  clientId: string;
  fetch?: typeof globalThis.fetch;
  gatewayUrl: string;
  getClientSecret: () => Promise<string>;
  now?: () => number;
}

export interface EnsureTenantOptions {
  idempotencyKey: string;
}

export interface SendMessageOptions {
  idempotencyKey: string;
}

export interface ListConversationsOptions {
  cursor?: string;
  integrationId: string;
  limit?: number;
}

export interface ListConversationMessagesOptions {
  cursor?: string;
  limit?: number;
}

export class MessagingGatewayApiError extends Error {
  public readonly code: string;
  public readonly correlationId: string;
  public readonly retryable: boolean;
  public readonly statusCode: number;

  public constructor(input: {
    code: string;
    correlationId: string;
    message: string;
    retryable: boolean;
    statusCode: number;
  }) {
    super(input.message);
    this.name = "MessagingGatewayApiError";
    this.code = input.code;
    this.correlationId = input.correlationId;
    this.retryable = input.retryable;
    this.statusCode = input.statusCode;
  }
}

export class MessagingGatewayClient {
  readonly #clientId: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #gatewayUrl: string;
  readonly #getClientSecret: () => Promise<string>;
  readonly #now: () => number;
  #token: { expiresAt: number; value: string } | undefined;
  #tokenRequest: Promise<string> | undefined;

  public constructor(config: MessagingGatewayClientConfig) {
    this.#clientId = config.clientId;
    this.#fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#gatewayUrl = config.gatewayUrl.replace(/\/+$/, "");
    this.#getClientSecret = config.getClientSecret;
    this.#now = config.now ?? Date.now;
  }

  public async ensureTenant(
    request: EnsureTenantRequest,
    options: EnsureTenantOptions,
  ): Promise<EnsureTenantResponse> {
    const parsedRequest = ensureTenantRequestSchema.parse(request);

    if (options.idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey is required.");
    }

    return this.#authorizedRequest(
      "/v1/tenants",
      {
        body: JSON.stringify(parsedRequest),
        headers: {
          "content-type": "application/json",
          "idempotency-key": options.idempotencyKey,
        },
        method: "POST",
      },
      (value) => ensureTenantResponseSchema.parse(value),
    );
  }

  public async sendMessage(
    request: SendMessageRequest,
    options: SendMessageOptions,
  ): Promise<SendMessageResponse> {
    const parsedRequest = sendMessageRequestSchema.parse(request);

    if (options.idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey is required.");
    }

    return this.#authorizedRequest(
      "/v1/messages",
      {
        body: JSON.stringify(parsedRequest),
        headers: {
          "content-type": "application/json",
          "idempotency-key": options.idempotencyKey,
        },
        method: "POST",
      },
      (value) => sendMessageResponseSchema.parse(value),
    );
  }

  public listConversations(
    tenantId: string,
    options: ListConversationsOptions,
  ): Promise<ListConversationsResponse> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);
    const query = conversationListQuerySchema.parse(options);
    const searchParams = new URLSearchParams({
      integrationId: query.integrationId,
      limit: String(query.limit),
    });
    if (query.cursor !== undefined) searchParams.set("cursor", query.cursor);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}/conversations?${searchParams.toString()}`,
      { method: "GET" },
      (value) => listConversationsResponseSchema.parse(value),
    );
  }

  public listConversationMessages(
    tenantId: string,
    conversationId: string,
    options: ListConversationMessagesOptions = {},
  ): Promise<ListConversationMessagesResponse> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);
    const parsedConversationId = conversationIdSchema.parse(conversationId);
    const query = conversationMessageListQuerySchema.parse(options);
    const searchParams = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor !== undefined) searchParams.set("cursor", query.cursor);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}/conversations/${encodeURIComponent(parsedConversationId)}/messages?${searchParams.toString()}`,
      { method: "GET" },
      (value) => listConversationMessagesResponseSchema.parse(value),
    );
  }

  public deleteConversation(tenantId: string, conversationId: string): Promise<void> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);
    const parsedConversationId = conversationIdSchema.parse(conversationId);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}/conversations/${encodeURIComponent(parsedConversationId)}`,
      { method: "DELETE" },
      () => undefined,
    );
  }

  public createRealtimeTicket(tenantId: string): Promise<RealtimeTicketResponse> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}/realtime/tickets`,
      {
        method: "POST",
      },
      (value) => realtimeTicketResponseSchema.parse(value),
    );
  }

  public getWhatsappEmbeddedSignupConfiguration(
    tenantId: string,
  ): Promise<WhatsappEmbeddedSignupConfigurationResponse> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}/integrations/whatsapp/embedded-signup/config`,
      { method: "GET" },
      (value) => whatsappEmbeddedSignupConfigurationResponseSchema.parse(value),
    );
  }

  public completeWhatsappEmbeddedSignup(
    tenantId: string,
    request: CompleteWhatsappEmbeddedSignupRequest,
  ): Promise<CompleteWhatsappEmbeddedSignupResponse> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);
    const parsedRequest = completeWhatsappEmbeddedSignupRequestSchema.parse(request);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}/integrations/whatsapp/embedded-signup`,
      {
        body: JSON.stringify(parsedRequest),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
      (value) => completeWhatsappEmbeddedSignupResponseSchema.parse(value),
    );
  }

  public getTenantByExternalAccount(externalAccountId: string): Promise<EnsureTenantResponse> {
    const parsedExternalAccountId =
      ensureTenantRequestSchema.shape.externalAccountId.parse(externalAccountId);

    return this.#authorizedRequest(
      `/v1/tenants/by-external-account/${encodeURIComponent(parsedExternalAccountId)}`,
      { method: "GET" },
      (value) => ensureTenantResponseSchema.parse(value),
    );
  }

  public getTenantById(tenantId: string): Promise<EnsureTenantResponse> {
    const parsedTenantId = tenantIdSchema.parse(tenantId);

    return this.#authorizedRequest(
      `/v1/tenants/${encodeURIComponent(parsedTenantId)}`,
      { method: "GET" },
      (value) => ensureTenantResponseSchema.parse(value),
    );
  }

  public clearToken(): void {
    this.#token = undefined;
  }

  async #authorizedRequest<TResult>(
    path: string,
    request: RequestInit,
    parse: (value: unknown) => TResult,
  ): Promise<TResult> {
    const accessToken = await this.#getAccessToken();
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${accessToken}`);
    const response = await this.#fetch(`${this.#gatewayUrl}${path}`, {
      ...request,
      headers,
    });
    const body = response.status === 204 ? undefined : await readJson(response);

    if (!response.ok) {
      throw toApiError(response.status, body);
    }

    return parse(body);
  }

  async #getAccessToken(): Promise<string> {
    if (this.#token !== undefined && this.#token.expiresAt > this.#now()) {
      return this.#token.value;
    }

    this.#tokenRequest ??= this.#issueAccessToken();

    try {
      return await this.#tokenRequest;
    } finally {
      this.#tokenRequest = undefined;
    }
  }

  async #issueAccessToken(): Promise<string> {
    const response = await this.#fetch(`${this.#gatewayUrl}/v1/auth/token`, {
      body: JSON.stringify({
        clientId: this.#clientId,
        clientSecret: await this.#getClientSecret(),
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const body = await readJson(response);

    if (!response.ok) {
      throw toApiError(response.status, body);
    }

    const token: TokenResponse = tokenResponseSchema.parse(body);
    const safetyWindowSeconds = Math.min(30, Math.floor(token.expiresIn / 2));
    this.#token = {
      expiresAt: this.#now() + (token.expiresIn - safetyWindowSeconds) * 1_000,
      value: token.accessToken,
    };

    return token.accessToken;
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new MessagingGatewayApiError({
      code: "INVALID_RESPONSE",
      correlationId: response.headers.get("x-correlation-id") ?? "unknown",
      message: "The messaging gateway returned an invalid JSON response.",
      retryable: response.status >= 500,
      statusCode: response.status,
    });
  }
};

const toApiError = (statusCode: number, body: unknown): MessagingGatewayApiError => {
  const parsed = publicErrorResponseSchema.safeParse(body);

  if (!parsed.success) {
    return new MessagingGatewayApiError({
      code: "INVALID_RESPONSE",
      correlationId: "unknown",
      message: "The messaging gateway returned an invalid error response.",
      retryable: statusCode >= 500,
      statusCode,
    });
  }

  return new MessagingGatewayApiError({
    ...parsed.data.error,
    statusCode,
  });
};
