# Telegram API guide

## Base URL

Development:

```text
https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
```

All private routes require:

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

Commands that create effects also require:

```http
Idempotency-Key: <stable-unique-key>
```

Never store BotFather tokens in source code, `.env` files committed to Git, message payloads, SQS
bodies, or logs.

## 1. Obtain an application access token

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

The SDK obtains and caches this token automatically. Provider tokens are never used here.

## 2. Register a Telegram bot

Required application scope:

```text
integrations:write
```

```http
POST /v1/tenants/{tenantId}/integrations/telegram
Authorization: Bearer <access-token>
Idempotency-Key: telegram-bot:<stable-reference>
Content-Type: application/json
```

```json
{
  "botToken": "<token-issued-by-botfather>",
  "displayName": "Customer support bot",
  "dropPendingUpdates": false
}
```

Fields:

| Field                | Required | Description                                                              |
| -------------------- | -------- | ------------------------------------------------------------------------ |
| `botToken`           | Yes      | BotFather credential. It is validated with Telegram `getMe`.             |
| `displayName`        | Yes      | Internal human-readable integration name.                                |
| `dropPendingUpdates` | No       | Defaults to `false`. Use `true` only to discard queued Telegram updates. |

Successful response:

```json
{
  "botId": "123456789",
  "botUsername": "example_bot",
  "displayName": "Customer support bot",
  "integrationId": "int_...",
  "provider": "TELEGRAM",
  "status": "ACTIVE",
  "tenantId": "tenant_...",
  "webhookUrl": "https://gateway.example/webhooks/telegram/<opaque-key>"
}
```

The gateway:

1. Calls Telegram `getMe`.
2. Creates an opaque webhook key and secret token.
3. Encrypts the BotFather token and webhook secret with the stage KMS key and stores only the
   ciphertext in DynamoDB.
4. Creates the provider connection and channel integration records.
5. Calls Telegram `setWebhook`.
6. Changes all integration references from `PENDING` to `ACTIVE`.

The response never contains either secret, its ciphertext, or the KMS key ARN.

Provider credentials are isolated per `providerConnectionId`. They are not accumulated in one global
JSON document and are not stored in the database of each MVP. AWS Secrets Manager remains in use
only for the gateway's stage-level JWT signing secret and authentication pepper.

### Registering another bot

Call the same endpoint with the other bot's token and a new idempotency key. A Telegram bot ID can
belong to only one active integration in the current stage.

Credential rotation for the same Telegram bot is not yet exposed as a public endpoint. Until that
route is implemented, do not overwrite the DynamoDB credential item manually: it must be encrypted
with the required KMS context, and `setWebhook` must also be called with the new secret token.

## 3. Discover chats dynamically

A private Telegram bot cannot arbitrarily discover or contact users. The user first opens:

```text
https://t.me/<botUsername>
```

and sends `/start` or another message. Telegram then invokes the configured webhook with an update
containing:

```json
{
  "update_id": 10001,
  "message": {
    "message_id": 42,
    "date": 1785000000,
    "chat": {
      "id": 123456789,
      "type": "private"
    },
    "from": {
      "id": 123456789,
      "username": "example"
    },
    "text": "/start"
  }
}
```

The gateway automatically:

- Uses `message.chat.id` as the technical Telegram destination.
- Keeps `message.from.id` separately as the sender user ID.
- Creates or updates the contact identity.
- Generates a deterministic `conversationId`.
- Persists the normalized inbound message.
- Deduplicates by Telegram `update_id`.

For groups and channels, `chat.id` and `from.id` commonly differ. Applications should use the
gateway `conversationId`, not assume those IDs are equal.

Application-event delivery and the public conversation-list endpoint are still pending. During
development, the deployment operator can verify newly created conversations directly in DynamoDB.

## 4. Send text to an existing conversation

Required application scope:

```text
messages:send
```

```http
POST /v1/messages
Authorization: Bearer <access-token>
Idempotency-Key: order-confirmed:order_123
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
      "body": "Tu pedido fue confirmado."
    }
  },
  "clientReferenceId": "order_123"
}
```

This is the preferred response flow after a user has contacted the bot.

## 5. Send text directly to a known Telegram chat

Use this only when the application already has a trusted Telegram Bot API `chat.id`:

```http
POST /v1/messages
Authorization: Bearer <access-token>
Idempotency-Key: notification:456
Content-Type: application/json
```

```json
{
  "tenantId": "tenant_...",
  "integrationId": "int_...",
  "recipient": {
    "type": "TELEGRAM_CHAT_ID",
    "value": "123456789"
  },
  "content": {
    "type": "TEXT",
    "text": {
      "body": "Hola desde Tinkiva."
    }
  }
}
```

`recipient` and `conversationId` are mutually exclusive; exactly one is required. Chat IDs are
represented as strings because Telegram IDs can be large and group/channel IDs can be negative.
Usernames are not accepted as stable destinations.

Accepted response:

```http
202 Accepted
```

```json
{
  "idempotencyKey": "notification:456",
  "messageId": "msg_...",
  "status": "QUEUED"
}
```

Repeating the same idempotency key with the same request returns the original `messageId`. Reusing
the key with a different request returns:

```text
409 IDEMPOTENCY_KEY_REUSED
```

## 6. SDK usage

```ts
const result = await messaging.sendMessage(
  {
    tenantId,
    integrationId,
    conversationId,
    content: {
      type: "TEXT",
      text: {
        body: "Tu pedido fue confirmado.",
      },
    },
    clientReferenceId: orderId,
  },
  {
    idempotencyKey: `order-confirmed:${orderId}`,
  },
);
```

The SDK validates requests and responses, caches the application JWT, and adds authorization and
idempotency headers. It never exposes or accepts the Telegram provider token.

## 7. Telegram webhook

```http
POST /webhooks/telegram/{webhookKey}
X-Telegram-Bot-Api-Secret-Token: <generated-secret>
Content-Type: application/json
```

This is a provider-facing route configured automatically by bot registration. Applications must not
call it or store its generated secret.

Expected provider response:

```http
202 Accepted
```

Unsupported Telegram update types are acknowledged but not enqueued. Invalid webhook keys or secret
tokens are rejected before queue publication.

## 8. Current limitations

- Text messages are supported inbound and outbound.
- Media currently returns `422 MESSAGE_NOT_SENDABLE`.
- The application event dispatcher and conversation query API remain pending.
- A same-bot credential-rotation endpoint remains pending.
- Telegram does not support a provider-side idempotency key for `sendMessage`; the gateway uses
  durable message state and a processing lease to minimize duplicate retries.
