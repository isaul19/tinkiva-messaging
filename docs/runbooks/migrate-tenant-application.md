# Migrate a tenant between applications

Use `admin:migrate-tenant-application` when an existing tenant must move to another application
without changing its tenant, integration, webhook, provider-connection, conversation, or message
identifiers.

The command migrates ownership in one conditional DynamoDB transaction across the control and data
tables. It updates conversation GSI partition keys, preserves encrypted provider credentials, and
does not migrate ephemeral realtime connections. Updates to historical message records retain their
status, so `appEventProjector` does not emit duplicate events.

## Preconditions

- The target application exists and is `ACTIVE`.
- The source tenant and its ownership links exist and are `ACTIVE`.
- Inbound and outbound queues have no visible, delayed, or in-flight messages.
- The transaction requires no more than 100 items. The command refuses larger migrations.
- The target application's consumer remains disabled until verification finishes.

## Dry run

```powershell
pnpm admin:migrate-tenant-application `
  --from-application-id app_<source> `
  --to-application-id app_<target> `
  --tenant-id tenant_<id> `
  --stage dev `
  --region us-east-1
```

Confirm the reported tenant, external account, integrations, conversations, record counts, and
transaction size before continuing.

## Execute

```powershell
pnpm admin:migrate-tenant-application `
  --from-application-id app_<source> `
  --to-application-id app_<target> `
  --tenant-id tenant_<id> `
  --stage dev `
  --region us-east-1 `
  --execute true
```

DynamoDB applies every ownership change or none of them. Existing records are guarded by source
application and tenant conditions, while new ownership links require their target keys not to exist.

## Verification

1. Confirm the source application has no durable control or message records for the tenant.
2. Authenticate using the target application's Secrets Manager credential.
3. List the tenant's integrations and require the original IDs and statuses.
4. List conversations per integration and compare the IDs and counts from the dry run.
5. Confirm webhook and provider reference keys are unchanged.
6. Confirm the target automation queue did not receive historical events.
7. Configure the target backend credential, enable its SQS consumer, disable obsolete polling, and
   restart the backend process.

Do not print or copy the Secrets Manager `SecretString` during verification.
