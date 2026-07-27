# WhatsApp webhook URL and registration rollback

Deployment date: 2026-07-26  
Stage: `dev`  
Region: `us-east-1`  
Stack: `tinkiva-messaging-gateway-dev`

## Purpose

The development stack previously generated WhatsApp callback URLs with
`https://messaging-api.tinkiva.com`. That hostname had no API Gateway custom-domain mapping, so Meta
could accept the initial WABA subscription and then reject the callback override. The failed
registration remained indexed as `ERROR`, which made the WABA and phone number look occupied during
every retry.

## Change

The `dev` Serverless parameter `publicBaseUrl` now resolves to:

```text
https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
```

Both WhatsApp and Telegram callback URLs inherit the stage-specific public base URL. Production
continues to use the configured custom-domain default and must not be deployed until that DNS name
has a real API Gateway mapping.

WhatsApp registration now behaves as a compensated operation:

1. Validate the phone number with Meta.
2. Store the encrypted credential.
3. Create the six pending integration indexes.
4. Subscribe the WABA and install the callback override.
5. Mark all indexes `ACTIVE`.
6. If step 4 or 5 fails, transactionally delete the six pending indexes and delete the encrypted
   credential.

The conditional deletes verify the expected `integrationId` or `providerConnectionId`. A normal Meta
rejection therefore leaves no uniqueness lock and the same WABA or phone number can be registered
again immediately. If the DynamoDB compensation itself fails, the best-effort fallback marks the
attempt as `ERROR` so it remains visible for manual reconciliation instead of silently hiding an
inconsistent state.

## Commands used

```powershell
pnpm verify
pnpm package
pnpm exec serverless deploy --stage dev --force
aws lambda get-function-configuration `
  --function-name tinkiva-messaging-gateway-dev-privateApi `
  --query Environment.Variables.WHATSAPP_WEBHOOK_BASE_URL `
  --output text
```

The failed test integration was removed with one conditional DynamoDB `TransactWriteItems`
operation. It deleted only:

- the provider-connection metadata;
- the encrypted provider credential;
- the integration metadata;
- the tenant integration reference;
- the webhook reference;
- the WABA uniqueness reference;
- the phone-number uniqueness reference.

The tenant itself and all unrelated integrations were preserved. A consistent `BatchGetItem` after
the transaction returned zero items for those seven keys.

## AWS resources

No AWS resource was created, renamed, or deleted. CloudFormation updated the code and environment of
the existing Lambdas in the existing stack. The cleanup removed application records from the
existing `messaging-control-dev` table; it did not remove the table or change its schema.

## Verification

- `pnpm verify`: 50 test files and 116 tests passed.
- Coverage: statements 93.64%, branches 81.52%, functions 93.89%, lines 94.03%.
- `pnpm package`: infrastructure validation passed.
- Lambda environment: `WHATSAPP_WEBHOOK_BASE_URL` equals the API Gateway endpoint above.
- `GET /health`: returned `{"service":"tinkiva-messaging-gateway","status":"ok"}`.
- Consistent DynamoDB verification: all seven failed-integration keys were absent.

## Retry and exceptional recovery

The user may submit the manual WhatsApp registration again with a valid access token. A provider or
callback rejection is now automatically recoverable. A process termination between persistence and
compensation, or a simultaneous DynamoDB outage during compensation, can still leave a stale
`PENDING` or `ERROR` attempt; operators should inspect the seven records and remove them with the
same conditional transaction after confirming ownership.

Rollback the code by deploying the previous source revision. Do not restore the deleted failed
integration records: they contained no active subscription and would recreate the uniqueness lock.
