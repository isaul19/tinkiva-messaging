# Deployment history

## 2026-07-26 — WhatsApp Embedded Signup platform activation

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Meta App ID: `1393451145991555`.
- Meta Facebook Login for Business Configuration ID: `1563719192007796`.
- Configuration version: `1`.
- Updated at: `2026-07-26T04:57:22.681Z`.

The repository administrative CLI decrypted the App Secret from provider connection
`pc_01KYDYA1NRJ6RX68XFZ63YFRFV` only in process memory, then KMS encrypted it with the platform
Embedded Signup encryption context and wrote:

```text
PK=PLATFORM#WHATSAPP
SK=EMBEDDED_SIGNUP
```

No plaintext secret was printed, logged, committed, or returned. No CloudFormation resource, Secrets
Manager secret, table, or KMS key was created.

Authenticated verification returned `200` with `configured=true`, the expected public IDs, and Graph
API `v25.0`. Live customer onboarding remains pending implementation of the Storagia frontend
button/BFF flow.

## 2026-07-25 — WhatsApp Embedded Signup v4 backend

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- AWS update time: `2026-07-26T03:25:12.904000+00:00`.

### Added

- Protected browser-safe Embedded Signup configuration endpoint.
- Protected one-time authorization-code completion endpoint.
- Central Meta App Secret ciphertext at `PLATFORM#WHATSAPP / EMBEDDED_SIGNUP` in the existing
  control table and KMS key.
- Administrative CLI that copies the App Secret from an existing encrypted provider connection
  without printing it.
- Meta code exchange, app/scope validation, and reuse of the existing isolated WABA onboarding.
- Typed SDK methods and a Storagia BFF/frontend guide for Embedded Signup v4.
- No new AWS resource, table, key, Secrets Manager secret, Lambda, or IAM permission.

### Verification

- `pnpm verify`: 48 files and 114 tests passed.
- Coverage: 95.06% statements, 83.14% branches, 98.34% functions, 95.19% lines.
- `pnpm package`: 9 Lambdas, 15 API routes, 9 IAM roles, and all validators passed.
- Authenticated configuration request returned `200`, `configured=false`, and Graph API `v25.0`.
- Authenticated completion negative smoke returned `409 PROVIDER_CONFIGURATION_INVALID` before Meta
  access or persistence, as expected until the Meta Configuration ID is supplied.

The backend deployment initially remained unconfigured; the following activation entry records the
later Configuration ID setup. A live browser onboarding is still pending.

## 2026-07-25 — Tenant integration discovery endpoint

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- AWS update time: `2026-07-26T02:33:25.523000+00:00`.

### Added

- Protected `GET /v1/tenants/{tenantId}/integrations` with `integrations:read`.
- Tenant/application ownership checks on integration and credential metadata.
- Provider-specific Telegram/WhatsApp metadata plus current `credentialVersion`.
- DynamoDB projection expressions that exclude ciphertext and webhook/provider secrets.
- No new AWS resource or IAM permission.

### Verification

- `pnpm verify`: 44 files and 104 tests passed.
- Coverage: 94.78% statements, 82.87% branches, 98.21% functions, 94.92% lines.
- `pnpm package`: 9 Lambdas, 13 API routes, 9 IAM roles, and all validators passed.
- Live JWT-authenticated request returned `200` and the active demo WhatsApp integration at
  credential version `2`.

## 2026-07-25 — Manual WhatsApp access-token rotation

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- AWS update time: `2026-07-26T02:02:06.549000+00:00`.
- Deployment command: the documented phase 4 Serverless command with the same alarm email, public
  base URL, and Graph API version parameters.

### Added

- Protected `PUT /v1/tenants/{tenantId}/integrations/whatsapp/{integrationId}/credentials`.
- Meta token ownership, permission, WABA, and phone-number validation before persistence.
- KMS re-encryption with optimistic DynamoDB credential-version concurrency.
- Immediate version detection for warm Lambda credential caches.
- `kms:Decrypt` on the exact provider key for the private API role; no wildcard resources and no new
  AWS resource.

### Verification

- `pnpm verify`: 42 files, 101 tests; coverage 95.59% statements, 82.87% branches, 98.18% functions,
  and 95.74% lines.
- `pnpm package`: 9 Lambdas, 12 API routes, 9 IAM roles, and all infrastructure validators passed.
- Live authenticated rotation returned `200`, advanced the demo credential from version `1` to `2`,
  and preserved integration status `ACTIVE`.
- A consistent DynamoDB read confirmed version `2` and update time `2026-07-26T01:56:50.230Z`.
- No provider plaintext was written to source, logs, command output, or documentation.

## 2026-07-25 — Phase 4 WhatsApp Cloud API

- Operator: Codex using AWS user `saul`.
- Stage: `dev`.
- Region: `us-east-1`.
- AWS account: `160358212333`.
- CloudFormation stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- Last update: `2026-07-26T01:22:42.639000+00:00`.
- API URL: `https://2myga1gnfl.execute-api.us-east-1.amazonaws.com`.
- Graph API version: `v25.0`.
- Command:

  ```powershell
  pnpm exec serverless deploy --stage dev --region us-east-1 `
    --param="alarmEmail=porrasemiliosaul@gmail.com" `
    --param="publicBaseUrl=https://2myga1gnfl.execute-api.us-east-1.amazonaws.com" `
    --param="whatsappGraphApiVersion=v25.0"
  ```

### Added

- Protected WhatsApp onboarding route.
- Meta challenge and signed webhook routes.
- WhatsApp webhook and sender Lambdas with dedicated IAM roles.
- WhatsApp sender SQS event-source mapping.
- DynamoDB/KMS per-connection credential vault shared safely with Telegram.
- WABA, phone-number, provider-connection, integration, tenant, and webhook references.
- Inbound BSUID/phone normalization, outbound delivery, and provider status updates.

The WhatsApp queue, DLQ, and DLQ alarm were already declared in phase 1 and are now connected to the
runtime sender.

### Verification

- Repository verification: 38 test files and 90 tests passed.
- Coverage: 95.54% statements, 82.84% branches, 98.09% functions, 95.71% lines.
- CloudFormation packaging: 9 Lambdas, 11 routes, 9 IAM roles, and 3 SQS event-source mappings.
- All phase 1-4 infrastructure validators passed.
- Unknown webhook key returned `404`.
- Authenticated onboarding with an intentionally invalid Meta credential returned
  `400 PROVIDER_CREDENTIAL_INVALID`.
- DynamoDB still contained zero WhatsApp records after the negative smoke.
- Live Meta app Webhooks subscription, base WABA subscription, tenant callback override, and GET
  challenge succeeded.
- The demo tenant, integration, provider connection, WABA, phone, and webhook references are
  `ACTIVE`.
- A real inbound message persisted as `RECEIVED` with its BSUID identity, phone alias, and open
  conversation.
- A real outbound reply passed `202 QUEUED -> SENT -> DELIVERED`.
- The smoke exposed and verified fixes for inbound-processor `dynamodb:GetItem` access and
  phone-alias delivery from BSUID-based identities.

Full reproduction, resource behavior, rollback, and live-smoke evidence:
[phase-4-deployment.md](./phase-4-deployment.md).

## 2026-07-25 — Provider credential migration to DynamoDB and KMS

- Operator: Codex using AWS user `saul`.
- Stage: `dev`.
- Region: `us-east-1`.
- AWS account: `160358212333`.
- CloudFormation stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- Created KMS alias: `alias/tinkiva-messaging-provider-credentials-dev`.
- Created KMS key: `arn:aws:kms:us-east-1:160358212333:key/291abb40-fe00-447e-84a8-99d507748ae3`.
- Creation method: `AWS::KMS::Key` and `AWS::KMS::Alias` declared in
  `infrastructure/serverless/provider-credentials-kms.yml`, deployed through Serverless Framework.

### Migration

- Encrypted the existing Telegram bot token and webhook secret in memory with KMS.
- Stored one ciphertext item at `PK=PROVIDER_CONNECTION#<id>`, `SK=CREDENTIAL`.
- Replaced four legacy `secretArn` attributes with `credentialRef`.
- Verified that the credential item has ciphertext and contains no plaintext secret fields.
- Scheduled the former provider Secrets Manager secret for deletion with a seven-day recovery
  window.

### Verification

- KMS key state: `Enabled`; usage: `ENCRYPT_DECRYPT`; origin: `AWS_KMS`.
- Automatic KMS rotation: enabled every 365 days.
- Deployed webhook decrypted the migrated ciphertext before rejecting an intentionally invalid
  signature with `401 WEBHOOK_SIGNATURE_INVALID`.
- Complete live Telegram smoke succeeded: inbound `/start` persisted as `RECEIVED`, authenticated
  send returned `202`, and the queued response reached `SENT` with a provider message ID.
- Full reproduction and rollback notes:
  [0003-dynamodb-kms-provider-credentials.md](../architecture/0003-dynamodb-kms-provider-credentials.md).

## 2026-07-25 — Phase 2 applications, clients, and tenants

- Operator: Codex using AWS user `saul`.
- Stage: `dev`.
- Region: `us-east-1`.
- AWS account: `160358212333`.
- CloudFormation stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- API URL: `https://2myga1gnfl.execute-api.us-east-1.amazonaws.com`.
- Command:

  ```powershell
  pnpm exec serverless deploy --stage dev --region us-east-1 `
    --param="alarmEmail=porrasemiliosaul@gmail.com"
  ```

### Added

- Token Lambda and `POST /v1/auth/token`.
- JWT request authorizer.
- Private tenant Lambda and three protected tenant routes.
- Dedicated least-privilege IAM role for each phase 2 Lambda.
- Administrative application/client CLI.
- Initial TypeScript SDK.
- Development application `TINKIVA_DEV`.
- Credentials secret `/tinkiva/messaging/dev/applications/tinkiva_dev/client`.

### Verification

- Repository verification: 28 tests passed.
- Coverage: 93.38% statements, 80.48% branches, 98.11% functions, 93.75% lines.
- CloudFormation packaging and all three infrastructure validators passed.
- External authenticated smoke test:
  - token `200`;
  - initial tenant creation `201`;
  - idempotent replay `200`;
  - both tenant queries `200`.
- CloudFormation final state: `UPDATE_COMPLETE`.
- SNS email subscription exists but remains `PendingConfirmation`.

The first authenticated tenant write exposed a missing `dynamodb:PutItem` action in the private
Lambda role. DynamoDB returned `AccessDeniedException`; its transaction wrote no partial records.
The role and phase 2 infrastructure validator were corrected before the successful smoke test.

Full resource inventory, reproduction commands, application identifiers, smoke-test records, and
rollback notes are in [phase-2-deployment.md](./phase-2-deployment.md).

## 2026-07-25 — Development application stack

- Operator: Codex using AWS user `saul`.
- Stage: `dev`.
- Region: `us-east-1`.
- AWS account: `160358212333`.
- CloudFormation stack: `tinkiva-messaging-gateway-dev`.
- Final status: `CREATE_COMPLETE`.
- Final creation time: `2026-07-25T18:05:47.906Z`.
- Command:

  ```powershell
  pnpm exec serverless deploy --stage dev --region us-east-1
  ```

### Attempts

The first CloudFormation creation attempt failed while AWS created the account's managed
`alias/aws/dynamodb` key. DynamoDB briefly returned `KMS NotFoundException` for the new key ID.
CloudFormation rolled the entire stack back to deletion.

After `stack-delete-complete` and confirmation that `alias/aws/dynamodb` was enabled, the exact same
template was deployed again successfully. No custom customer-managed KMS key was created.

### Deployed inventory

- 30 CloudFormation resources, all `CREATE_COMPLETE`.
- API Gateway HTTP API and `/health` route.
- One health Lambda, log group, permission, and dedicated IAM role.
- Two DynamoDB tables.
- Five SQS source queues and five DLQs.
- One private media S3 bucket and bucket policy.
- Two generated Secrets Manager secrets.
- One SNS alarm topic and five CloudWatch alarms.

### CloudFormation outputs

```text
HttpApiId=2myga1gnfl
HttpApiUrl=https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
ControlTableName=messaging-control-dev
DataTableName=messaging-data-dev
MediaBucketName=tinkiva-messaging-media-dev-160358212333
InboundQueueUrl=https://sqs.us-east-1.amazonaws.com/160358212333/messaging-inbound-events-dev.fifo
WhatsappOutboundQueueUrl=https://sqs.us-east-1.amazonaws.com/160358212333/messaging-outbound-whatsapp-dev.fifo
TelegramOutboundQueueUrl=https://sqs.us-east-1.amazonaws.com/160358212333/messaging-outbound-telegram-dev.fifo
AppEventsQueueUrl=https://sqs.us-east-1.amazonaws.com/160358212333/messaging-app-events-dev.fifo
MediaQueueUrl=https://sqs.us-east-1.amazonaws.com/160358212333/messaging-media-dev
AlarmTopicArn=arn:aws:sns:us-east-1:160358212333:tinkiva-messaging-alarms-dev
```

Secret ARNs are available as stack outputs but their values were never read during verification.

### Artifact traceability

```text
tinkiva-messaging-gateway-health.zip
SHA256=F484FD47685C2631301797AD45AB297A38658058BCA97E7365CBAC041AAD7361

cloudformation-template-update-stack.json
SHA256=240E78925BADD135F0715731569CDC9A0BDE87841FC2E698CC5382AADF540114
```

Git was not initialized, so no source revision or commit identifies this deployment.

### Verification

- CloudFormation: 30/30 resources `CREATE_COMPLETE`.
- DynamoDB: tables `ACTIVE`, `PAY_PER_REQUEST`, encryption and TTL enabled.
- SQS: encryption enabled; source retention 4 days; DLQ retention 14 days; redrive configured.
- S3: AES256 encryption, all public access blocked, `BucketOwnerEnforced`, TLS-only policy,
  raw-event lifecycle enabled.
- IAM: health role contains only its own CloudWatch Logs resource; no wildcard resource.
- CloudWatch: five DLQ alarms in `OK`, threshold 1.
- SNS: no subscription configured at the time of phase 1 deployment.
- Health returned `200` with the expected liveness body.

### Rollback

Deploy the previous source state with the same command. Do not run `serverless remove` after real
messages or media exist without following the data-retention checklist in
`phase-1-resource-plan.md`.

## 2026-07-25 — Serverless Framework account bootstrap

- Operator: Codex using the locally authenticated Serverless session and AWS user `saul`.
- Stage: account-level tooling; no application stage deployed.
- Region: `us-east-1`.
- AWS account: `160358212333`.
- Command that triggered creation: `pnpm package`.
- Created resource: `s3://serverless-framework-deployments-us-east-1-62fbc4c4-ee83`.
- AWS creation time: `2026-07-25T17:15:47Z`.
- Purpose: shared Serverless Framework v4 artifact bucket for this AWS account and region.

Security verification:

- Every S3 public-access block is enabled.
- Default encryption is SSE-S3 (`AES256`).
- Versioning is enabled.
- Object ownership is `BucketOwnerEnforced`.

This bucket is managed at the Serverless account level and is not part of the application stack. Do
not delete it until every Serverless service in this account and region has been checked.
