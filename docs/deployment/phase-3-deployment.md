# Phase 3 Telegram deployment

## Deployment identity

- Date: 2026-07-25
- AWS account: `160358212333`
- Region: `us-east-1`
- Stage: `dev`
- CloudFormation stack: `tinkiva-messaging-gateway-dev`
- API base URL: `https://2myga1gnfl.execute-api.us-east-1.amazonaws.com`
- Final stack status: `UPDATE_COMPLETE`

No Telegram bot token is stored in the repository or in environment files. Provider credentials are
created only when a bot is registered and are stored under:

```text
/tinkiva/messaging/{stage}/provider-connections/{providerConnectionId}
```

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
  - Reads only the matching provider secret.
  - Publishes verified updates to `messaging-inbound-events-dev.fifo`.
- `tinkiva-messaging-gateway-dev-inboundProcessor`
  - Consumes the inbound FIFO queue.
  - Normalizes Telegram text messages.
  - Persists identities, conversations, messages, and durable provider-event idempotency records.
- `tinkiva-messaging-gateway-dev-telegramSender`
  - Consumes `messaging-outbound-telegram-dev.fifo`.
  - Loads the provider credential from Secrets Manager.
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
tables, SQS queue, Lambda log group, and provider-secret path required by that function.

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

The gateway calls `getMe` before persisting anything, creates the secret and records as `PENDING`,
calls `setWebhook`, and atomically changes the integration references to `ACTIVE`. If record
creation fails, the newly created secret is deleted immediately. The response never contains the bot
token or webhook secret.

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

- `pnpm verify`: 63 tests passed.
- Coverage: 95.23% statements, 83.80% branches, 98.73% functions, 95.47% lines.
- `pnpm package`: 7 Lambdas, 8 API routes, 7 IAM roles, and 2 SQS event-source mappings validated.
- CloudFormation: `UPDATE_COMPLETE`.
- Authenticated smoke:
  - Token endpoint returned a valid access token.
  - `POST /v1/messages` with an intentionally missing integration returned
    `404 INTEGRATION_NOT_FOUND`.
  - This verified the route, `messages:send` scope, authorizer, Lambda code, and DynamoDB reads
    without sending a real Telegram message or creating a queue record.

## Remaining live verification and limitations

- A real BotFather token and a target Telegram `chat.id` are still required for a complete live
  webhook/send test.
- Telegram media payloads are rejected with `422 MESSAGE_NOT_SENDABLE` until the media worker is
  implemented.
- Telegram has no provider-side idempotency key for `sendMessage`. The sender uses a durable state
  and five-minute processing lease. A process termination in the narrow interval after Telegram
  accepts a message but before DynamoDB stores `SENT` can still result in a duplicate retry.
- Confirm the SNS subscription sent to `porrasemiliosaul@gmail.com`; AWS previously reported
  `PendingConfirmation`.
