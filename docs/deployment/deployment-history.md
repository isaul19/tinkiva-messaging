# Deployment history

## 2026-08-12 — OpenAI inbound media enrichment and platform administration

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- AWS update time: `2026-08-12T19:34:31.004000+00:00`.

### Added

- Per-integration, default-off audio transcription and image alternative text for inbound Telegram
  and WhatsApp messages using the OpenAI API.
- Dedicated asynchronous media worker, SQS queue/DLQ, per-integration OpenAI credentials encrypted
  with KMS in DynamoDB, tenant/application media ownership checks, and retry-safe enrichment
  publication.
- `gpt-5.6-luna` Responses image analysis with `store: false` and `gpt-4o-mini-transcribe` file
  transcription; AAC, AMR, and OGG inputs are normalized with the packaged Linux ARM64 FFmpeg
  binary.
- Platform administration HTML at `/admin` plus `platform:admin`-protected APIs for listing
  integrations, counting chats, changing media settings, deleting chats, and deleting local
  integrations with their chats.
- BYOK credential controls and protected PUT/DELETE APIs for creating, rotating, and removing each
  integration's OpenAI project credential without returning either plaintext or ciphertext.
- Resumable administrative deletion pages that remove dependent references/media before source
  records and require a strongly consistent final conversation scan.

### Verification

- `pnpm verify`: 85 test files and 252 tests passed.
- Coverage: 93.02% statements, 80.88% branches, 95.60% functions, and 93.73% lines.
- `pnpm package`: 133 logical resources and all infrastructure validators passed; exactly the two
  base authentication secrets remain, and the media worker package contains an ELF64 AArch64 FFmpeg
  binary only in that Lambda artifact.
- The media worker is `Active` with `LastUpdateStatus=Successful`, Node.js 22, ARM64, 1,024 MB, and
  a 120-second timeout. Its queue mapping is enabled with batch size 2, partial-batch responses, a
  720-second visibility timeout, and zero visible or in-flight messages after deployment.
- Live `/health` returned `200`; `/admin` returned hardened HTML with CSP and `no-store`; anonymous
  access to both credential mutation routes returned `401`.
- The deployed admin role can encrypt but not decrypt OpenAI credentials; the worker can decrypt but
  not encrypt them. Both are scoped to the provider-credentials KMS key and the `OPENAI_CREDENTIAL`
  encryption context, with no Secrets Manager permission.
- A strongly consistent scan found zero OpenAI credential records after deployment. All four
  existing integrations remain active with both media-enrichment options disabled.
- Live global-administration smoke issued a 15-minute JWT from the dedicated `PLATFORM_ADMIN`
  client, listed all four integrations across two pages, created and immediately removed a dummy
  per-integration OpenAI credential, and confirmed that the API exposed only status/version
  metadata. Enabling enrichment afterward failed closed with `409 OPENAI_CREDENTIAL_REQUIRED`;
  DynamoDB returned to zero OpenAI credential items and both flags remained disabled.
- The running StoragIA EC2 instance uses its dedicated instance profile with receive/delete/change
  visibility permissions scoped to the StoragIA automation FIFO queue.

### Operational follow-up

- The historical empty global secret `/tinkiva/messaging/dev/openai/account` was removed. OpenAI
  credentials are now BYOK and scoped to each integration in DynamoDB; they are never stored there
  in plaintext.
- Media enrichment remains disabled by default. Configure a dedicated OpenAI project credential for
  an integration through `/admin` before enabling audio or image enrichment, as documented in the
  media enrichment guide.
- The pre-existing WhatsApp outbound DLQ alarm remains in `ALARM` for one message first observed on
  2026-07-30. This deployment did not inspect, delete, or redrive that unrelated message.
- A read-only audit found active legacy reads of the Storagia and Tinkiva Dev application-client
  Secrets. They were not deleted or consolidated. The `storagia-dev-backend-ec2` inline policy was
  narrowed on 2026-08-12 from `/applications/*` to the exact Storagia Secret ARN; IAM simulation
  confirmed `implicitDeny` for the platform-admin Secret.
- The application-creation CLI now defaults to one-time `clientSecret` delivery and stores only its
  HMAC digest in DynamoDB. Secrets Manager delivery remains an explicit `--credentials-secret-name`
  compatibility option, including for the single global `PLATFORM_ADMIN` credential.

## 2026-08-08 — Point location messages

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- AWS update time: `2026-08-08T20:51:43.657000+00:00`.

### Added

- Inbound Telegram and WhatsApp point locations normalized as `type: "LOCATION"` with numeric
  `latitude` and `longitude`.
- Coordinate validation, DynamoDB persistence, conversation-history projection, and realtime event
  projection for location messages.
- Live-location updates and frontend rendering remain outside this deployment.

### Verification

- `pnpm verify`: 69 test files and 166 tests passed.
- Coverage: 92.79% statements, 81.68% branches, 94.93% functions, and 93.42% lines.
- `pnpm package`: 118 logical resources and all infrastructure validators passed.
- The affected `inboundProcessor`, `privateApi`, and `appEventProjector` Lambdas are `Active` with
  `LastUpdateStatus=Successful`.
- Live gateway health returned `200` with `{"service":"tinkiva-messaging-gateway","status":"ok"}`.
- No `ERROR` entries were found in the affected Lambda log groups during post-deployment checks.

## 2026-07-31 — StoragIA tenant ownership migration

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Source application: `app_01KYDBQZ876JBP1E9CNXQ70CXB` (`TINKIVA_DEV`).
- Target application: `app_01KYWMW9VBW6N08DH9DEMJAME4` (`STORAGIA`).
- Tenant: `tenant_01KYEGH6FH0CG1XW8M26NMZDFM`.
- External account: `cd3a8f4e-6ceb-4f34-aba5-c0b996e3013f`.

### Migrated

- Tenant ownership links were moved to the dedicated StoragIA application without changing the
  tenant ID or external account ID.
- WhatsApp integration `int_01KYG60AKPEBFEHPWXW65EJTCS` and Telegram integration
  `int_01KYKSSKKTVC7K2ZV635JQY6HE` retained their IDs and `ACTIVE` status.
- Provider connection, encrypted credential, webhook, WhatsApp phone-number, and WABA references
  retained their keys; only application ownership changed.
- Two WhatsApp conversations retained their IDs, index order, identities, and message history.
- Thirteen message records moved to the target application. Message-reference and provider-event
  idempotency records did not require changes because their keys do not contain an application ID.
- Ephemeral realtime connections are deliberately excluded from ownership migration.

The change was applied as one 30-item DynamoDB transaction with conditional ownership checks. A
status-only guard in `appEventProjector` means the message ownership updates did not create new
realtime or automation events.

### Verification

- Source application ownership records for the tenant: `0`.
- Source application message records for the tenant: `0`.
- Target application control records: `14`; target message records: `13`.
- The target conversation GSI returned the same two WhatsApp conversation IDs.
- The StoragIA automation queue remained empty after migration.
- Authentication with the StoragIA Secrets Manager credential succeeded without printing the secret.
- Authenticated API reads returned both integrations as `ACTIVE`, two WhatsApp conversations, and
  zero Telegram conversations.
- `pnpm verify`: 66 test files and 159 tests passed after adding the migration CLI.

## 2026-07-31 — StoragIA automation queue

- Operator: Codex using AWS user `saul`.
- Stage: `dev`; region: `us-east-1`; account: `160358212333`.
- Stack: `tinkiva-messaging-gateway-dev`.
- Final status: `UPDATE_COMPLETE`.
- AWS update time: `2026-07-31T17:53:15.367000+00:00`.
- StoragIA application: `app_01KYWMW9VBW6N08DH9DEMJAME4`.

### Added

- Dedicated `STORAGIA` M2M application and credentials secret at
  `/tinkiva/messaging/dev/applications/storagia/client`; plaintext credentials were not printed.
- FIFO queue `messaging-storagia-automation-dev.fifo` and its dedicated 14-day DLQ.
- Conditional fan-out of StoragIA `message.received` events for inbound messages while preserving
  publication to the existing realtime queue.
- DLQ alarm connected to the existing messaging alarm SNS topic.
- Queue URL/ARN and DLQ URL/ARN CloudFormation outputs.
- Producer-only IAM permission for `appEventProjector`; the stack deliberately has no Lambda event
  source mapping for the automation queue because its consumer belongs to the StoragIA backend on
  EC2.

### Verification

- `pnpm verify`: 66 test files and 159 tests passed.
- Coverage: 93.03% statements, 81.65% branches, 94.90% functions, 93.56% lines.
- `pnpm package`: 118 logical resources, 12 SQS queues, 6 CloudWatch alarms, and all infrastructure
  validators passed using the real StoragIA application ID.
- Live gateway health returned `200` with `status=ok`.
- The queue is FIFO with explicit deduplication, per-message-group throughput, 300-second
  visibility, four-day retention, 20-second long polling, and redrive after five receives.
- The DLQ is FIFO with 14-day retention; its CloudWatch alarm was `OK`.
- Lambda configuration contains the dedicated application ID and deployed queue URL.
- AWS returned no event source mappings whose ARN contains `messaging-storagia-automation`.

The StoragIA EC2 deployment must use the new credentials secret and consume the queue with long
polling before automation messages are processed. That consumer deployment is outside this stack.

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

## 2026-07-26 — Conversation inbox API and Storagia integration

- Operator: Codex using the authenticated AWS administrator profile.
- Stage: `dev`.
- Region: `us-east-1`.
- Gateway stack: `tinkiva-messaging-gateway-dev`.
- Existing HTTP API: `2myga1gnfl`.
- Existing control table: `messaging-control-dev`.
- Existing data table: `messaging-data-dev`.

Commands:

```powershell
pnpm verify
pnpm package
pnpm exec serverless deploy --stage dev
pnpm admin:backfill-conversation-index -- --table messaging-control-dev --region us-east-1
pnpm admin:backfill-conversation-index -- --table messaging-control-dev --region us-east-1 --apply
```

No new AWS service or billable standalone resource was created. The deployment added two routes to
the existing HTTP API and updated the existing private API/inbound/outbound Lambdas:

```text
GET /v1/tenants/{tenantId}/conversations
GET /v1/tenants/{tenantId}/conversations/{conversationId}/messages
```

The control table already had `GSI1`; conversation records now use a sparse partition scoped by
application, tenant, and integration. The dry run found two pre-existing conversation records and
the apply run updated both with `applicationId`, `GSI1PK`, and `GSI1SK`. Re-running the command is
safe because already indexed records are skipped.

Verification:

- `pnpm verify`: 49 files and 115 tests passed; coverage remained above 80% in every category.
- Direct API Gateway route inspection confirmed both GET routes after deployment.
- Authenticated live query returned one WhatsApp conversation and four durable messages.
- The first conversation included inbound and outbound records, including `READ` and `FAILED`
  delivery states.
- Storagia backend and frontend dev stacks were deployed separately after their own lint, test, and
  build checks.

Rollback: deploy the previous gateway source state. Do not delete either DynamoDB table or remove
the added index attributes; older Lambda versions ignore them and they preserve message history.

## 2026-07-26 — WhatsApp webhook URL and retry-safe registration

- Stage: `dev`; region: `us-east-1`.
- Existing stack redeployed: `tinkiva-messaging-gateway-dev`.
- The development callback base URL now uses the existing API Gateway endpoint.
- Failed provider registration now compensates all pending indexes and the encrypted credential,
  allowing the same WABA and phone number to be retried.
- The prior failed test integration was conditionally removed from `messaging-control-dev`; the
  tenant and unrelated integrations were preserved.
- No AWS resource was created, renamed, or deleted.
- Verification: 50 test files, 116 tests, package validation, live health check, deployed Lambda
  environment check, and a consistent DynamoDB read showing zero remaining failed-integration keys.

Full procedure and recovery notes: `docs/deployment/whatsapp-webhook-retry-fix.md`.

## 2026-07-26 — Realtime messaging delivery and Storagia WebSocket integration

- Operator: Codex using the authenticated AWS administrator profile.
- Stage: `dev`.
- Region: `us-east-1`.
- Gateway stack: `tinkiva-messaging-gateway-dev`.
- Storagia stacks: `storagia-backend-dev` and `storagia-frontend-dev`.

Commands:

```powershell
pnpm verify
pnpm package
pnpm exec serverless deploy --stage dev

Set-Location C:\Proyectos\StoragIA\Backend
pnpm run ci
pnpm run serverless-deploy-dev

Set-Location C:\Proyectos\StoragIA\Frontend
pnpm run lint
pnpm run build
pnpm run serverless-deploy-dev
```

CloudFormation created or updated:

```text
WebSocket API: wss://u854ghkv5h.execute-api.us-east-1.amazonaws.com/dev
Lambda: tinkiva-messaging-gateway-dev-appEventProjector
Lambda: tinkiva-messaging-gateway-dev-realtimeConnection
Lambda: tinkiva-messaging-gateway-dev-realtimeDispatcher
IAM role: tinkiva-messaging-app-event-projector-dev
IAM role: tinkiva-messaging-realtime-connection-dev
IAM role: tinkiva-messaging-realtime-dispatcher-dev
DynamoDB stream mapping: 442e96df-5ae8-47da-a822-ca89c3f80dea
SQS dispatcher mapping: cd4282b9-501f-46f5-a7fb-c3a7f3ff13b7
```

The existing `messaging-data-dev` table was updated with `NEW_AND_OLD_IMAGES`. The existing
`messaging-app-events-dev.fifo`, its DLQ, and the control table were reused. No DynamoDB table, SQS
queue, NAT Gateway, or always-on server was added.

Deployment recovery:

- The first update failed because API Gateway had not yet observed its account-level CloudWatch role
  while creating the WebSocket stage.
- Rollback left `/aws/lambda/tinkiva-messaging-gateway-dev-custom-resource-apigw-cw-role` as an
  unowned log group with zero stored bytes.
- The exact empty log group was deleted and cannot be recovered; it contained no events.
- A live handshake then exposed missing DynamoDB transaction sub-actions. The dedicated roles and
  the packaged-template validator were updated with the required `DeleteItem` and `PutItem`
  permissions before the final deployment.

Verification:

- TinkivaMessaging: 55 test files and 123 tests passed; overall branch coverage was 81.72%.
- Storagia backend: 51 test suites and 214 tests passed, followed by Nest build.
- Storagia frontend: TypeScript/Vite build and Oxlint passed; existing Fast Refresh warnings remain.
- Authenticated ticket creation returned `201`.
- WebSocket `$connect` consumed the ticket and `ping` returned `pong`.
- Reusing the already consumed ticket was rejected during the handshake.
- A temporary synthetic message traversed DynamoDB Stream, `appEventProjector`, the existing FIFO,
  `realtimeDispatcher`, and the scoped WebSocket as `message.received`.
- The temporary message was deleted immediately; the event queue and DLQ both reported zero visible
  and zero in-flight messages afterward.
- The public health endpoint returned `{"service":"tinkiva-messaging-gateway","status":"ok"}`.

Full architecture, endpoint, payload, cost, and rollback procedure:
`docs/deployment/realtime-messaging.md`.
