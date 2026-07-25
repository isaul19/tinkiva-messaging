# Implementation status

## Phase 0 — repository base

- [x] Strict TypeScript configuration.
- [x] pnpm project configuration and lockfile.
- [x] ESLint, Prettier, Vitest, enforced coverage thresholds, and build scripts.
- [x] Serverless Framework v4 base configuration and authentication.
- [x] Versioned tenant, message, event, and queue contracts.
- [x] Minimal `/health` Lambda.
- [x] Initial architecture, deployment, and runbook documentation.
- [x] Format, lint, typecheck, tests, coverage, and build.
- [x] Serverless packaging.

## Phase 1 — AWS infrastructure

- [x] Modular CloudFormation resources.
- [x] API Gateway HTTP API and health Lambda.
- [x] Two encrypted on-demand DynamoDB tables.
- [x] Five source queues and five DLQs with encryption and redrive policies.
- [x] Private encrypted S3 media bucket and raw-event lifecycle.
- [x] Generated authentication pepper and JWT signing secrets.
- [x] SNS alarm topic and five DLQ alarms.
- [x] Dedicated least-privilege role for the health Lambda.
- [x] CloudFormation outputs.
- [x] Packaged-template invariant and output-shape validators.
- [x] AWS CloudFormation verification.
- [x] Resource inventory, cost posture, and rollback documentation.
- [x] Deployed `tinkiva-messaging-gateway-dev`.
- [x] Audited effective AWS resource configuration.
- [x] Verified the deployed `/health` endpoint.
- [x] Created the SNS email subscription for `porrasemiliosaul@gmail.com`.
- [ ] Confirm the SNS subscription from the recipient mailbox; AWS still reports
      `PendingConfirmation`.

## Phase 2 — applications, clients, and tenants

- [x] Secure administrative CLI for application/client registration.
- [x] One-time client secret generation, HMAC digest storage, and Secrets Manager delivery.
- [x] Short-lived HS256 JWT token endpoint.
- [x] Request authorizer that rechecks current application, client, and scopes.
- [x] Dedicated least-privilege IAM role per phase 2 Lambda.
- [x] Idempotent `POST /v1/tenants`.
- [x] Application-scoped tenant lookup by external account or tenant ID.
- [x] Atomic tenant, forward link, inverse link, and idempotency records.
- [x] Initial TypeScript SDK with token caching and response validation.
- [x] CloudFormation shape validation for Lambdas, authorizer, and phase 2 IAM.
- [x] Unit coverage above 80% for statements, branches, functions, and lines.
- [x] Authenticated end-to-end smoke test in AWS.
- [x] Reproducible deployment and administrative resource documentation.

## Phase 3 — Telegram

- [x] Bot credential validation and registration endpoint.
- [x] Per-connection provider credential ciphertext in DynamoDB, encrypted with a stage KMS key.
- [x] Secret-token-protected Telegram webhook.
- [x] FIFO publication with conversation ordering and provider-event deduplication.
- [x] Inbound text normalization and atomic identity/conversation/message persistence.
- [x] `POST /v1/messages` with durable command idempotency.
- [x] Telegram outbound FIFO publisher and sender Lambda.
- [x] Durable outgoing message states and retry lease.
- [x] TypeScript SDK `sendMessage` method.
- [x] Live inbound and outbound Telegram smoke test through webhook, SQS, DynamoDB, KMS, and sender.
- [x] Dedicated least-privilege IAM roles and packaged-template validators.
- [x] Deployed AWS stack and authenticated non-destructive smoke test.
- [x] Reproducible phase 3 deployment documentation.
- [ ] Complete a live end-to-end test with a real BotFather token and Telegram `chat.id`.
- [ ] Add inbound and outbound media processing.
- [ ] Publish normalized application events; this belongs to the application-delivery phase.
