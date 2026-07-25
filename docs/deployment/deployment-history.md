# Deployment history

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
