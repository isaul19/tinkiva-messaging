# ADR 0003: Provider credentials in DynamoDB encrypted with KMS

- Status: Accepted
- Date: 2026-07-25

## Context

Each tenant can connect its own Telegram bot and, later, its own WhatsApp account. Creating one AWS
Secrets Manager secret per provider connection adds a fixed per-secret charge that grows linearly
with the number of companies.

Storing provider tokens as plaintext DynamoDB attributes is not acceptable. DynamoDB server-side
encryption protects storage media, but a principal allowed to read the table would still receive
plaintext values.

Authentication infrastructure has a different lifecycle. The JWT signing secret and authentication
pepper are stage-level values, not tenant-level provider credentials, and remain in Secrets Manager.

## Decision

Provider credentials are encrypted in the application before being stored in the control table:

```text
PK=PROVIDER_CONNECTION#{providerConnectionId}
SK=CREDENTIAL
```

The record contains:

```json
{
  "entityType": "PROVIDER_CREDENTIAL",
  "provider": "TELEGRAM",
  "providerConnectionId": "pc_...",
  "credentialCiphertext": "<base64 KMS ciphertext>",
  "credentialKeyArn": "<stage KMS key ARN>",
  "credentialVersion": 1
}
```

It never contains `botToken`, `webhookSecretToken`, `accessToken`, `appSecret`, or `secretArn`.
Provider connection and webhook records keep only `credentialRef`, currently equal to
`providerConnectionId`.

One customer-managed symmetric KMS key is created per stage by CloudFormation. Encryption uses this
mandatory context:

```text
provider=TELEGRAM
providerConnectionId={providerConnectionId}
stage={stage}
tableName={controlTableName}
```

Decryption must provide the same context. This prevents a ciphertext copied to another connection,
stage, provider, or table from being decrypted there.

## IAM boundaries

- The private API can write the credential item and call `kms:Encrypt`.
- Telegram webhook and sender Lambdas can read the credential item and call `kms:Decrypt`.
- Provider runtime roles do not receive Secrets Manager permissions.
- Authentication Lambdas retain narrowly scoped `secretsmanager:GetSecretValue` permissions for the
  JWT signing secret and authentication pepper.
- No provider Lambda receives `kms:*` or access to every KMS key.

Decrypted credentials are cached only in Lambda memory for five minutes. They are never written to
environment variables, queues, logs, API responses, or plaintext DynamoDB attributes.

## Cost and operational consequences

The design replaces a recurring secret charge per provider connection with one KMS key per stage,
DynamoDB item storage, and KMS request charges. It therefore improves marginal cost as the number of
connected companies grows, while retaining application-layer encryption. For a very small number of
connections, the fixed KMS key charge can be higher than one individual Secrets Manager secret.

KMS key rotation is enabled. CloudFormation retains the key if the stack or resource is removed so
existing ciphertext is not made permanently unreadable by an accidental stack deletion.

Credential rotation must write a newly encrypted version and update the provider webhook when
required. Operators must not edit ciphertext directly.

## Reproduction

The resource is declared in
[`infrastructure/serverless/provider-credentials-kms.yml`](../../infrastructure/serverless/provider-credentials-kms.yml)
and included by `serverless.yml`. Recreate or update it with the normal stack deployment:

```powershell
pnpm verify
pnpm package
pnpm exec serverless deploy `
  --stage dev `
  --region us-east-1 `
  --param="alarmEmail=porrasemiliosaul@gmail.com" `
  --param="publicBaseUrl=https://2myga1gnfl.execute-api.us-east-1.amazonaws.com"
```

The stack exports `ProviderCredentialsKeyArn`. Lambdas receive it as `PROVIDER_CREDENTIALS_KEY_ARN`;
no key ARN or provider token belongs in an `.env` file.

Development currently uses:

```text
alias/tinkiva-messaging-provider-credentials-dev
arn:aws:kms:us-east-1:160358212333:key/291abb40-fe00-447e-84a8-99d507748ae3
```

Verify the deployed key without reading any provider credential:

```powershell
aws kms describe-key `
  --key-id alias/tinkiva-messaging-provider-credentials-dev `
  --region us-east-1

aws kms get-key-rotation-status `
  --key-id 291abb40-fe00-447e-84a8-99d507748ae3 `
  --region us-east-1
```

## Migration record

The existing development Telegram credential was read in memory, encrypted using the context above,
and stored as a `CREDENTIAL` item. Four control-table references were changed from `secretArn` to
`credentialRef`; verification confirmed that no legacy plaintext or `secretArn` field remains.

The old Secrets Manager secret was scheduled for deletion with a seven-day recovery window rather
than force-deleted. This preserves rollback capability during the migration window.
