# ADR 0001: Independent multi-tenant messaging gateway

- Status: Accepted
- Date: 2026-07-25

## Context

Several Tinkiva applications need Telegram and WhatsApp messaging without duplicating provider
adapters, credentials, message history, retry logic, or webhook handling. Their local account
identifiers are owned by separate application databases and can collide.

## Decision

The messaging gateway is an independently deployed service. It owns provider connections,
integrations, normalized identities, conversations, messages, media pointers, and delivery events.

Consumer applications authenticate as separate `ApplicationClient` identities. Access is granted
through an explicit `(applicationId, externalAccountId) -> tenantId` link. The gateway does not
connect to consumer PostgreSQL databases.

Provider-specific payloads are validated and converted at the channel boundary. The domain and
public contracts do not expose Meta or Telegram transport payloads.

## Consequences

- Applications can use the same gateway without sharing credentials or tenant data.
- Every repository and authorization query must include a mandatory tenant/application boundary.
- Cross-application tenant sharing requires an explicit administrative link and audit record.
- Eventual consistency is accepted between a consumer database and the gateway.
- Provider secrets belong in AWS Secrets Manager, never consumer databases or source control.
