# Phase 2 deployment: applications, clients, and tenants

Deployment date: 2026-07-25  
AWS account: `160358212333`  
Region: `us-east-1`  
Stage: `dev`  
Stack: `tinkiva-messaging-gateway-dev`  
Final stack status: `UPDATE_COMPLETE`

## Reproducible stack deployment

All stack resources and permissions are declared in `serverless.yml` and
`infrastructure/serverless/*.yml`.

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm package
pnpm exec serverless deploy --stage dev --region us-east-1 `
  --param="alarmEmail=porrasemiliosaul@gmail.com"
```

The `alarmEmail` parameter must be supplied on every deployment while the subscription is desired.
As of this deployment, AWS reports `PendingConfirmation`; the recipient must use the confirmation
link sent by Amazon SNS.

## Resources added in phase 2

CloudFormation added or manages:

- Lambda `tinkiva-messaging-gateway-dev-authToken`.
- Lambda `tinkiva-messaging-gateway-dev-apiAuthorizer`.
- Lambda `tinkiva-messaging-gateway-dev-privateApi`.
- Dedicated CloudWatch log group for each Lambda with 14-day retention.
- API Gateway request authorizer with simple responses and a zero-second result cache.
- Three dedicated IAM roles:
  - `tinkiva-messaging-auth-token-dev`
  - `tinkiva-messaging-authorizer-dev`
  - `tinkiva-messaging-private-api-dev`
- Lambda invoke permissions, API integrations, and the four phase 2 API routes.

The deployed API base URL is:

```text
https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
```

Routes:

```text
POST /v1/auth/token
POST /v1/tenants
GET  /v1/tenants/by-external-account/{externalAccountId}
GET  /v1/tenants/{tenantId}
```

The three tenant routes require a Bearer token. `POST /v1/tenants` additionally requires an
`Idempotency-Key` header and the `tenants:write` scope.

## Runtime permissions

The token Lambda can read application/client records and only the authentication pepper and JWT
signing secrets. The authorizer can read application/client records and only the JWT signing secret.
The private API can read/query the control table and create tenant records atomically.

The private API policy intentionally includes both `dynamodb:TransactWriteItems` and
`dynamodb:PutItem`. DynamoDB authorizes the component `Put` operations in a transaction as
`PutItem`; omitting it caused the first authenticated smoke test to return `500`. The transaction
was atomic and wrote no partial tenant records. `scripts/validate-phase2-infrastructure.mjs` now
asserts the required action and prevents regression.

No phase 2 runtime role uses `Resource: "*"`.

## Initial development application

The administrative CLI created:

```text
application code: TINKIVA_DEV
applicationId: app_01KYDBQZ876JBP1E9CNXQ70CXB
clientId: msgc_01KYDBQZ88EMNER8GKW3MV4WE5
credentials secret: /tinkiva/messaging/dev/applications/tinkiva_dev/client
```

The plaintext client secret was generated in memory, hashed with the authentication pepper for
DynamoDB, and stored with its client ID in Secrets Manager. It was not printed or committed.

The credentials secret is intentionally created by the administrative CLI rather than CloudFormation
because it is application-instance data. It is tagged:

```text
DataClassification=secret
ManagedBy=tinkiva-messaging-admin-cli
Project=tinkiva-messaging
Stage=dev
```

To create another application:

```powershell
pnpm admin:create-application `
  --code STORAGIA `
  --name "Storagia" `
  --stage dev `
  --region us-east-1
```

Optional arguments:

```text
--scopes tenants:read,tenants:write,messages:read,messages:send
--credentials-secret-name /tinkiva/messaging/dev/applications/storagia/client
```

The CLI refuses an existing application code and returns only IDs and the secret ARN/name.

## Verification evidence

Repository verification:

```text
28 tests passed
Statements 93.38%
Branches 80.48%
Functions 98.11%
Lines 93.75%
```

CloudFormation package validation confirms the authorizer, three phase 2 Lambdas, required DynamoDB
actions, and absence of wildcard resources in phase 2 roles.

External smoke test using credentials read in memory from Secrets Manager:

```text
POST /v1/auth/token                                      -> 200
POST /v1/tenants                                        -> 201
POST /v1/tenants with the same key and body             -> 200
GET  /v1/tenants/by-external-account/codex-smoke-20260725 -> 200
GET  /v1/tenants/{tenantId}                             -> 200
```

Both reads and the idempotent replay returned:

```text
tenant_01KYDC95B084WX324PK2MYVN19
```

A second diagnostic tenant was created directly through the same DynamoDB adapter while isolating
the original IAM issue:

```text
tenant_01KYDBWGHC2T1RMQ4X48HFMVPS
```

These are development records and have no production or customer data.

## Rollback

Redeploy the previous source state with the same stage, region, and `alarmEmail` parameter. A
CloudFormation rollback does not remove application/client/tenant data already stored in DynamoDB
and does not delete the CLI-created credentials secret.

Do not use `serverless remove` once real data exists without the data-retention checklist. To revoke
the development client without deleting data, change its DynamoDB status from `ACTIVE` to `REVOKED`;
the authorizer rechecks current state on every request.
