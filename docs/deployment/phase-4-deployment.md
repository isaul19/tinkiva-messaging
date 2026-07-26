# Phase 4 WhatsApp deployment

## Deployment identity

- Date: 2026-07-25
- AWS account: `160358212333`
- Region: `us-east-1`
- Stage: `dev`
- CloudFormation stack: `tinkiva-messaging-gateway-dev`
- API base URL: `https://2myga1gnfl.execute-api.us-east-1.amazonaws.com`
- Final stack status: `UPDATE_COMPLETE`
- Last update reported by AWS: `2026-07-26T03:25:12.904000+00:00`
- Graph API version: `v25.0`

## Reproducible commands

Run from the repository root:

```powershell
pnpm install
pnpm verify
pnpm package
pnpm exec serverless deploy `
  --stage dev `
  --region us-east-1 `
  --param="alarmEmail=porrasemiliosaul@gmail.com" `
  --param="publicBaseUrl=https://2myga1gnfl.execute-api.us-east-1.amazonaws.com" `
  --param="whatsappGraphApiVersion=v25.0"
```

The Graph API version is explicit so a future Meta version change is reviewed rather than inherited
silently. The public base URL must be reachable by Meta during WABA subscription verification.

Confirm CloudFormation after any wrapper timeout:

```powershell
aws cloudformation describe-stacks `
  --stack-name tinkiva-messaging-gateway-dev `
  --region us-east-1 `
  --query "Stacks[0].[StackStatus,LastUpdatedTime]" `
  --output text
```

## Resources created or updated

Everything was declared in `serverless.yml` or modular CloudFormation and created by the existing
Serverless-managed stack. No application resource was created manually in the AWS console.

### HTTP routes

```text
GET  /v1/tenants/{tenantId}/integrations
POST /v1/tenants/{tenantId}/integrations/whatsapp
GET  /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup/config
POST /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup
PUT  /v1/tenants/{tenantId}/integrations/whatsapp/{integrationId}/credentials
GET  /webhooks/whatsapp/{webhookKey}
POST /webhooks/whatsapp/{webhookKey}
POST /v1/messages
```

The onboarding, credential-rotation, and message routes use the existing JWT authorizer. The webhook
routes are public provider endpoints protected by an opaque URL key plus Meta verification token or
raw-body HMAC-SHA256 signature, depending on the HTTP method.

### Lambdas

- `tinkiva-messaging-gateway-dev-privateApi`
  - Validates WABA and Phone Number ID using Graph API.
  - Encrypts credentials through KMS and stores only ciphertext in DynamoDB.
  - Exposes browser-safe Embedded Signup configuration and exchanges one-time Meta codes.
  - Validates the Embedded Signup token's app/scopes before reusing the normal isolated onboarding
    transaction.
  - Rotates access tokens conditionally by credential version after checking the same Meta app,
    required scopes, WABA, and phone number.
  - Performs the base WABA subscription, applies its tenant callback override, and exposes the
    existing provider-neutral message endpoint.
- `tinkiva-messaging-gateway-dev-whatsappWebhook`
  - Answers Meta's GET challenge.
  - Verifies `X-Hub-Signature-256` over the exact raw POST body.
  - Resolves `metadata.phone_number_id` and publishes messages/statuses to the inbound FIFO queue.
- `tinkiva-messaging-gateway-dev-inboundProcessor`
  - Dispatches Telegram and WhatsApp envelopes.
  - Normalizes WhatsApp BSUID and phone aliases.
  - Persists inbound messages and status transitions idempotently.
- `tinkiva-messaging-gateway-dev-whatsappSender`
  - Consumes `messaging-outbound-whatsapp-dev.fifo`.
  - Decrypts the per-connection credential.
  - Calls `/{phone-number-id}/messages`.
  - Persists `PROCESSING`, `SENT`, or `FAILED` and the provider message reference.

### IAM

Dedicated roles:

```text
tinkiva-messaging-whatsapp-webhook-dev
tinkiva-messaging-whatsapp-sender-dev
```

The private API role can send to the existing WhatsApp outbound queue and can encrypt/decrypt only
with the exact provider-credential KMS key. Decrypt is required during rotation to preserve the
existing App Secret and generated verification token while replacing only the access token. Runtime
provider roles have no Secrets Manager access and no phase 4 policy uses `Resource: "*"`.

The webhook role can:

- read exact control-table items;
- decrypt with the exact provider-credential KMS key;
- send to the exact inbound FIFO queue;
- write its own logs.

The inbound processor role was extended with `dynamodb:GetItem` on the messaging tables because
provider status handling reads the provider-message reference and current message before applying a
monotonic transition. The packaged validator now requires this action on `MessagingDataTable`.

The sender role can:

- consume only the WhatsApp outbound FIFO queue;
- read/update the two messaging tables;
- decrypt with the exact provider-credential KMS key;
- write its own logs.

### DynamoDB and KMS

No new table or Secrets Manager secret was created. Each company/provider connection stores:

```text
PK=PROVIDER_CONNECTION#{providerConnectionId}
SK=CREDENTIAL
```

The item contains KMS ciphertext for:

```json
{
  "accessToken": "<not stored in plaintext>",
  "appSecret": "<not stored in plaintext>",
  "verifyToken": "<generated, not stored in plaintext>"
}
```

The KMS encryption context binds the ciphertext to provider `WHATSAPP`, connection ID, stage, and
control table. Credential items start at `credentialVersion=1`. Rotation uses a conditional
`UpdateItem` against the expected application, tenant, provider connection, provider, and version,
then writes a newly encrypted blob and increments the version. Runtime readers perform a consistent
version check before reusing decrypted in-memory credentials. Provider connection, integration,
tenant, WABA, phone-number, and webhook reference records contain routing metadata but no provider
secrets.

A conditional `WHATSAPP_WABA#{wabaId}` reference prevents a second onboarding from overwriting the
WABA-level callback. Shared WABA connections with multiple numbers require a future onboarding
extension.

Embedded Signup adds one platform configuration item to the same table:

```text
PK=PLATFORM#WHATSAPP
SK=EMBEDDED_SIGNUP
```

It stores the public Meta App/Configuration IDs and a KMS ciphertext for Tinkiva's central App
Secret. The public GET endpoint never decrypts it. No new table, KMS key, or Secrets Manager secret
was created.

## Verification performed

- `pnpm verify`: 48 test files and 114 tests passed.
- Coverage:
  - statements: 95.06%;
  - branches: 83.14%;
  - functions: 98.34%;
  - lines: 95.19%.
- `pnpm package`:
  - 9 Lambda functions;
  - 15 API routes;
  - 9 IAM roles;
  - 3 SQS event-source mappings;
  - all phase 1-4 infrastructure validators passed.
- CloudFormation: `UPDATE_COMPLETE`.
- All 15 CloudFormation resources whose logical IDs contain `Whatsapp` reported `CREATE_COMPLETE`,
  including routes, roles, Lambdas, event source, queue, DLQ, and alarm.
- Authenticated Embedded Signup negative smoke:
  - token endpoint returned `200`;
  - public configuration returned `200` with `configured=false` and Graph API `v25.0`;
  - completion returned `409 PROVIDER_CONFIGURATION_INVALID` before calling Meta or persisting any
    tenant integration because the central Meta Configuration ID is intentionally pending.
- Embedded Signup platform activation:
  - the administrative CLI copied the existing App Secret only in process memory;
  - KMS wrote configuration version `1` at `2026-07-26T04:57:22.681Z`;
  - the platform item uses `PK=PLATFORM#WHATSAPP, SK=EMBEDDED_SIGNUP`;
  - authenticated configuration returned `200`, `configured=true`, App ID `1393451145991555`,
    Configuration ID `1563719192007796`, and Graph API `v25.0`;
  - no new AWS resource or Secrets Manager secret was created.
- Authenticated integration-list smoke:
  - token endpoint returned `200`;
  - `GET /v1/tenants/{tenantId}/integrations` returned `200`;
  - the demo WhatsApp integration returned `ACTIVE` at credential version `3`;
  - no provider secret or internal provider connection ID was returned.
- Public webhook negative smoke:
  - GET with an unknown opaque webhook key returned `404`.
- Authenticated onboarding negative smoke:
  - token endpoint returned `200`;
  - onboarding with an intentionally invalid Meta token returned `400 PROVIDER_CREDENTIAL_INVALID`;
  - a post-check found zero WhatsApp records in DynamoDB, confirming failure before persistence.

## Live Meta verification

The test Meta app was configured through Graph API for the `whatsapp_business_account/messages`
Webhooks subscription. The app was then associated with the test WABA and its callback was
overridden with the tenant-specific gateway endpoint.

Created test routing records:

```text
tenantId=tenant_01KYDY9ZD270X27P8WMJ8FGB9X
integrationId=int_01KYDYA1NRED6TQGFXCWX16G32
providerConnectionId=pc_01KYDYA1NRJ6RX68XFZ63YFRFV
status=ACTIVE
```

A live manual rotation used the already encrypted token as both old and replacement value so the
effective provider credential did not change. Authentication returned `200`; the rotation returned
`200`; DynamoDB advanced `credentialVersion` through manual rotations and is currently at `3`; and
the integration remained `ACTIVE`. Meta classified the test token as `USER` and reported expiration
at `2026-07-26T04:00:00Z`, demonstrating why it must be replaced with a production system-user
token.

The access token, App Secret, generated verification token, and opaque webhook key are intentionally
omitted. They remain only as KMS ciphertext in DynamoDB. Verification completed:

1. Meta app Webhooks subscription accepted;
2. base WABA subscription accepted;
3. WABA callback override accepted;
4. gateway challenge returned the exact challenge with HTTP 200;
5. all six routing references changed atomically to `ACTIVE`.

The live end-to-end smoke then completed:

1. a real inbound text invoked the signed webhook;
2. the FIFO inbound processor created an active BSUID identity, phone alias, open conversation, and
   `RECEIVED` message;
3. `POST /v1/messages` returned `202 QUEUED`;
4. the sender obtained a provider message ID and persisted `SENT`;
5. Meta's status webhook advanced the second smoke reply to `DELIVERED`.

The first reply exposed two defects that were corrected and redeployed:

- the inbound processor role lacked `dynamodb:GetItem` on `messaging-data-dev`; SQS retained the
  failed status event and processed it after the IAM update;
- a BSUID-based conversation used BSUID directly as Meta's `to` value and received error `131026`;
  delivery now uses the verified phone alias while BSUID remains the canonical identity.

No credential, complete phone number, message text, provider message ID, or opaque webhook key was
written to this document.

## Rollback

Deploy the previous source revision with the same stage, region, alarm email, and public base URL.
Do not delete the shared inbound queue, WhatsApp outbound queue, tables, or KMS key: these existed
before phase 4 or may contain provider and message state. If a real WABA is onboarded, unsubscribe
or replace its callback in Meta before removing the webhook Lambda.
