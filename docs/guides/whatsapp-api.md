# WhatsApp Cloud API guide

## Base URL

Development:

```text
https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
```

Private routes require:

```http
Authorization: Bearer <application-access-token>
Content-Type: application/json
```

Provider credentials must never be placed in source code, committed `.env` files, SQS messages,
logs, or an MVP database. The registration endpoint accepts them once over HTTPS, encrypts them with
the stage KMS key, and stores one ciphertext item in the gateway control table.

## 1. Meta prerequisites

Create or identify these values in Meta:

| Value                 | Required | Purpose                                                    |
| --------------------- | -------- | ---------------------------------------------------------- |
| Access token          | Yes      | Calls Graph API for the WABA and sends messages.           |
| App Secret            | Yes      | Verifies `X-Hub-Signature-256` on webhook requests.        |
| Meta App ID           | Yes      | Records which Meta app owns the provider connection.       |
| WABA ID               | Yes      | WhatsApp Business Account used for webhook subscription.   |
| Phone Number ID       | Yes      | Graph API sender and webhook routing identifier.           |
| Business Portfolio ID | No       | Operational metadata when the WABA belongs to a portfolio. |

Use a system-user access token for long-lived production operation. The token needs access to the
target WABA and the `whatsapp_business_management` and `whatsapp_business_messaging` permissions. Do
not confuse the visible phone number with the numeric Phone Number ID.

Before the first tenant is onboarded for a Meta app, configure that app's Webhooks product once:

- object: `whatsapp_business_account`;
- subscribed field: `messages`;
- callback URL and verification token: a reachable gateway webhook pair.

This app-level subscription is different from subscribing an app to a WABA. Tenant onboarding first
associates the app with the WABA and then applies the WABA-specific callback override. Meta app
development mode is sufficient for test numbers and app users/roles; production customers require
the corresponding Meta production review and access.

## 2. Obtain an application access token

```http
POST /v1/auth/token
Content-Type: application/json
```

```json
{
  "clientId": "msgc_...",
  "clientSecret": "msgs_..."
}
```

Response:

```json
{
  "accessToken": "<jwt>",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

This JWT authenticates the MVP with the gateway. It is unrelated to the Meta access token.

## 3. Register a WhatsApp integration

Required application scope:

```text
integrations:write
```

```http
POST /v1/tenants/{tenantId}/integrations/whatsapp
Authorization: Bearer <application-access-token>
Content-Type: application/json
```

```json
{
  "accessToken": "<meta-system-user-access-token>",
  "appSecret": "<meta-app-secret>",
  "businessPortfolioId": "123456789012345",
  "displayName": "Tinkiva customer support",
  "metaAppId": "234567890123456",
  "phoneNumberId": "345678901234567",
  "wabaId": "456789012345678"
}
```

`businessPortfolioId` is optional. All Meta identifiers are strings of decimal digits.

Successful response:

```http
201 Created
```

```json
{
  "displayName": "Tinkiva customer support",
  "displayPhoneNumber": "+57 300 000 0000",
  "integrationId": "int_...",
  "phoneNumberId": "345678901234567",
  "provider": "WHATSAPP",
  "status": "ACTIVE",
  "tenantId": "tenant_...",
  "verifiedName": "Tinkiva",
  "webhookUrl": "https://gateway.example/webhooks/whatsapp/<opaque-key>"
}
```

The gateway performs the complete onboarding:

1. Reads the WABA phone numbers from Graph API and verifies that `phoneNumberId` belongs to it.
2. Generates an opaque webhook key and a separate verification token.
3. Encrypts `accessToken`, `appSecret`, and the verification token with KMS.
4. Stores the ciphertext at `PK=PROVIDER_CONNECTION#{providerConnectionId}, SK=CREDENTIAL`.
5. Creates provider, integration, tenant, WABA, phone-number, and webhook references as `PENDING`.
6. Subscribes the Meta app to the WABA through the base `/{wabaId}/subscribed_apps` call.
7. Applies the tenant-specific callback override and generated verification token.
8. Changes all references to `ACTIVE`.

No secret, ciphertext, verification token, or KMS ARN is returned.

Meta configures the override callback at WABA level. The app-level callback is only the bootstrap
default; every registered tenant WABA receives its own opaque gateway callback. The webhook runtime
also verifies the phone number, tenant, and provider connection before enqueueing an event.

This release therefore reserves each WABA for one gateway integration. Attempting to register
another phone from the same WABA returns `409 PROVIDER_CONFIGURATION_INVALID` instead of overwriting
the existing callback. Shared WABA connections with multiple phone numbers are a future extension.

## 4. Receive messages dynamically

There is no `chat_id` to configure for WhatsApp. Meta sends the sender identity dynamically in every
webhook:

- `metadata.phone_number_id` selects the tenant integration.
- `contacts[].user_id` or `contacts[].bsuid`, when present, becomes the preferred stable BSUID.
- `contacts[].wa_id` or `messages[].from` becomes the normalized phone alias.
- The gateway creates a deterministic identity and conversation for the integration.

The provider-facing endpoints are:

```http
GET /webhooks/whatsapp/{webhookKey}
POST /webhooks/whatsapp/{webhookKey}
```

The GET endpoint is used only by Meta for subscription verification. The POST endpoint validates
`X-Hub-Signature-256` with HMAC-SHA256 over the exact raw request body before publishing anything to
SQS. Applications must not call these endpoints directly.

Inbound text is persisted as `RECEIVED`. Provider status events update outbound messages through:

```text
SENT -> DELIVERED -> READ
FAILED
```

Duplicate or older status updates do not regress durable message state.

## 5. Send text to an existing conversation

Required application scope:

```text
messages:send
```

```http
POST /v1/messages
Authorization: Bearer <application-access-token>
Idempotency-Key: support-reply:ticket_123
Content-Type: application/json
```

```json
{
  "tenantId": "tenant_...",
  "integrationId": "int_...",
  "conversationId": "conv_...",
  "content": {
    "type": "TEXT",
    "text": {
      "body": "Gracias por escribirnos."
    }
  },
  "clientReferenceId": "ticket_123"
}
```

This is the preferred reply flow because it uses the identity discovered from a verified inbound
message. When that identity is BSUID-based, the gateway preserves BSUID as the canonical identity
but uses the verified phone alias from the same webhook as Meta's message delivery destination.

## 6. Send text to a known WhatsApp recipient

By phone:

```json
{
  "tenantId": "tenant_...",
  "integrationId": "int_...",
  "recipient": {
    "type": "WHATSAPP_PHONE",
    "value": "+573001112233"
  },
  "content": {
    "type": "TEXT",
    "text": {
      "body": "Hola desde Tinkiva."
    }
  }
}
```

By BSUID:

```json
{
  "tenantId": "tenant_...",
  "integrationId": "int_...",
  "recipient": {
    "type": "WHATSAPP_BSUID",
    "value": "<business-scoped-user-id>"
  },
  "content": {
    "type": "TEXT",
    "text": {
      "body": "Hola desde Tinkiva."
    }
  }
}
```

`recipient` and `conversationId` are mutually exclusive. Phone values are normalized without the
leading `+`.

Accepted response:

```http
202 Accepted
```

```json
{
  "idempotencyKey": "support-reply:ticket_123",
  "messageId": "msg_...",
  "status": "QUEUED"
}
```

Repeating the same `Idempotency-Key` with the same request returns the original `messageId`. Reusing
it with another request returns `409 IDEMPOTENCY_KEY_REUSED`.

## 7. Operational boundaries

- Inbound and outbound text are implemented.
- Media and template payloads are not implemented yet.
- Free-form outbound text remains subject to Meta's customer-service conversation window. Outside
  that window, use of an approved template will be required once template sending is implemented.
- If Meta rejects a message permanently, the durable state becomes `FAILED`; transient failures
  release the processing lease for SQS retry.
- The application-event dispatcher and conversation query API remain pending.
- Credential rotation and shared WABA/multi-number onboarding routes remain pending. Do not
  overwrite ciphertext items manually because their KMS encryption context is mandatory.
