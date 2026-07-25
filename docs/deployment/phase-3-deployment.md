# Phase 3 Telegram deployment

## Deployment identity

- Date: 2026-07-25
- AWS account: `160358212333`
- Region: `us-east-1`
- Stage: `dev`
- CloudFormation stack: `tinkiva-messaging-gateway-dev`
- API base URL: `https://2myga1gnfl.execute-api.us-east-1.amazonaws.com`
- Final stack status: `UPDATE_COMPLETE`

No Telegram bot token is stored in the repository, environment files, or plaintext DynamoDB
attributes. Registration encrypts each provider credential with the stage KMS key and stores the
resulting ciphertext in the control table under:

```text
PK=PROVIDER_CONNECTION#{providerConnectionId}
SK=CREDENTIAL
```

AWS Secrets Manager remains limited to the authentication pepper and JWT signing secret.

## Reproducible commands

Run all commands from the repository root:

```powershell
pnpm install
pnpm verify
pnpm package
pnpm exec serverless deploy `
  --stage dev `
  --region us-east-1 `
  --param="alarmEmail=porrasemiliosaul@gmail.com" `
  --param="publicBaseUrl=https://2myga1gnfl.execute-api.us-east-1.amazonaws.com"
```

`pnpm package` runs the CloudFormation shape validators before deployment. Keep both parameters on
every full deployment so an update does not replace the alarm recipient or configure Telegram with
the placeholder custom domain.

Serverless may exceed a 60-second local wrapper timeout while CloudFormation continues. Do not start
another deployment blindly. Check the real state with:

```powershell
aws cloudformation describe-stacks `
  --stack-name tinkiva-messaging-gateway-dev `
  --region us-east-1 `
  --query "Stacks[0].StackStatus" `
  --output text
```

## Resources added

### Provider credential encryption

- CloudFormation resource: `ProviderCredentialsKey`.
- Alias: `alias/tinkiva-messaging-provider-credentials-dev`.
- Output: `ProviderCredentialsKeyArn`.
- Rotation: enabled every 365 days.
- Removal behavior: `Retain`, to avoid losing access to existing ciphertext on accidental stack
  removal.
- Storage: one `CREDENTIAL` item per provider connection in `messaging-control-dev`.
- Lambda cache: decrypted values remain only in process memory for up to five minutes.

See
[`0003-dynamodb-kms-provider-credentials.md`](../architecture/0003-dynamodb-kms-provider-credentials.md)
for the data model, encryption context, cost decision, and migration record.

### HTTP routes

```text
POST /v1/tenants/{tenantId}/integrations/telegram
POST /webhooks/telegram/{webhookKey}
POST /v1/messages
```

The integration and message routes use the existing application authorizer. Sending requires
`messages:send`; integration registration requires `integrations:write`.

### Lambdas and event sources

- `tinkiva-messaging-gateway-dev-telegramWebhook`
  - Validates the webhook key and `X-Telegram-Bot-Api-Secret-Token`.
  - Reads only the matching ciphertext and decrypts it with the stage KMS key.
  - Publishes verified updates to `messaging-inbound-events-dev.fifo`.
- `tinkiva-messaging-gateway-dev-inboundProcessor`
  - Consumes the inbound FIFO queue.
  - Normalizes Telegram text messages.
  - Persists identities, conversations, messages, and durable provider-event idempotency records.
- `tinkiva-messaging-gateway-dev-telegramSender`
  - Consumes `messaging-outbound-telegram-dev.fifo`.
  - Loads the matching ciphertext from DynamoDB and decrypts it with the stage KMS key.
  - Sends text with Telegram `sendMessage`.
  - Persists `PROCESSING`, `SENT`, or `FAILED`.

Both SQS consumers use batch size 10 and `ReportBatchItemFailures`. Their source queues already use
five receives before DLQ redrive, four-day source retention, fourteen-day DLQ retention, encryption,
and a visibility timeout of 180 seconds.

### IAM roles

Each Lambda has a dedicated role:

- `tinkiva-messaging-telegram-webhook-dev`
- `tinkiva-messaging-inbound-processor-dev`
- `tinkiva-messaging-telegram-sender-dev`

No phase 3 runtime policy uses `Resource: "*"`. Access is restricted to the specific DynamoDB
tables, SQS queue, Lambda log group, and exact provider-credential KMS key required by that
function. Provider runtime roles have no Secrets Manager access.

DynamoDB transactions require `dynamodb:TransactWriteItems` plus the permissions of their component
operations (`dynamodb:PutItem` and `dynamodb:UpdateItem`). The infrastructure validator asserts all
three for the inbound processor.

## Telegram bot onboarding

Obtain a token from BotFather, then call the private endpoint with an application JWT:

```http
POST /v1/tenants/{tenantId}/integrations/telegram
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "botToken": "<botfather-token>",
  "displayName": "Tinkiva notifications",
  "dropPendingUpdates": false
}
```

The gateway calls `getMe` before persisting anything, encrypts the credential with KMS, creates the
records as `PENDING`, calls `setWebhook`, and atomically changes the integration references to
`ACTIVE`. If record creation fails, the new credential item is deleted immediately. The response
never contains the bot token, webhook secret, or ciphertext.

## Sending with the SDK

```ts
const result = await messaging.sendMessage(
  {
    tenantId,
    integrationId,
    recipient: {
      type: "TELEGRAM_CHAT_ID",
      value: telegramChatId,
    },
    content: {
      type: "TEXT",
      text: { body: "Tu pedido fue confirmado." },
    },
    clientReferenceId: orderId,
  },
  {
    idempotencyKey: `order-confirmed:${orderId}`,
  },
);
```

The API returns `202` and the original `messageId` when the same idempotency key and body are
repeated. Reusing a key with another body returns `409 IDEMPOTENCY_KEY_REUSED`.

## Verification performed

- `pnpm verify`: 64 tests passed.
- Coverage: 95.22% statements, 83.80% branches, 98.73% functions, 95.46% lines.
- `pnpm package`: 7 Lambdas, 8 API routes, 7 IAM roles, 2 SQS event-source mappings, and one KMS key
  plus alias validated.
- CloudFormation: `UPDATE_COMPLETE`.
- Authenticated smoke:
  - Token endpoint returned a valid access token.
  - `POST /v1/messages` with an intentionally missing integration returned
    `404 INTEGRATION_NOT_FOUND`.
  - This verified the route, `messages:send` scope, authorizer, Lambda code, and DynamoDB reads
    without sending a real Telegram message or creating a queue record.
- KMS migration smoke:
  - the deployed webhook read the DynamoDB ciphertext and decrypted it successfully;
  - a deliberately invalid Telegram secret header was then rejected with
    `401 WEBHOOK_SIGNATURE_INVALID`;
  - four legacy `secretArn` attributes were removed after migration verification.
- Complete Telegram live smoke:
  - Telegram delivered the user's `/start` through the configured webhook;
  - the inbound FIFO processor stored the message as `RECEIVED` and dynamically created its identity
    and conversation;
  - the application token endpoint returned `200`;
  - `POST /v1/messages` returned `202 QUEUED` for that conversation;
  - the Telegram sender decrypted the DynamoDB credential with KMS, delivered the response, and
    persisted `SENT` with a provider message ID.

## Current limitations

- Telegram media payloads are rejected with `422 MESSAGE_NOT_SENDABLE` until the media worker is
  implemented.
- Telegram has no provider-side idempotency key for `sendMessage`. The sender uses a durable state
  and five-minute processing lease. A process termination in the narrow interval after Telegram
  accepts a message but before DynamoDB stores `SENT` can still result in a duplicate retry.
- Confirm the SNS subscription sent to `porrasemiliosaul@gmail.com`; AWS previously reported
  `PendingConfirmation`.
