# Initial TypeScript SDK usage

The initial in-repository SDK is exported from `src/sdk/index.ts`. It acquires and caches a
short-lived JWT, validates gateway responses, sends the idempotency header, and never requires a
provider credential. New applications receive their Messaging client secret once and must place it
in the consuming backend's existing credential vault.

```ts
import { MessagingGatewayClient } from "./src/sdk/index.js";

// Implement this adapter with the consumer's own vault or runtime configuration.
const credential = await loadMessagingClientCredentialFromConsumerVault();

const messaging = new MessagingGatewayClient({
  clientId: credential.clientId,
  gatewayUrl: "https://2myga1gnfl.execute-api.us-east-1.amazonaws.com",
  getClientSecret: async () => credential.clientSecret,
});

const tenant = await messaging.ensureTenant(
  {
    externalAccountId: account.id,
    externalAccountCode: account.code,
    name: account.name,
  },
  {
    idempotencyKey: `tenant:${account.id}`,
  },
);
```

Only backend services may use the application client secret. If a legacy AWS consumer still uses a
dedicated Secrets Manager entry, its workload must receive `secretsmanager:GetSecretValue` only for
that exact Secret ARN, never `/applications/*`. The Storagia example path remains operational during
the migration documented in
[`application-client-credentials.md`](./application-client-credentials.md).

## Conversation inbox

The SDK exposes the same paginated, tenant-isolated inbox used by Storagia:

```ts
const conversations = await messaging.listConversations(tenant.tenantId, {
  integrationId: "int_...",
  limit: 25,
});

const first = conversations.items[0];
if (first) {
  const messages = await messaging.listConversationMessages(tenant.tenantId, first.conversationId, {
    limit: 50,
  });

  await messaging.sendMessage(
    {
      tenantId: tenant.tenantId,
      integrationId: first.integrationId,
      conversationId: first.conversationId,
      content: {
        type: "TEXT",
        text: { body: "Gracias por escribirnos." },
      },
    },
    { idempotencyKey: `reply:${crypto.randomUUID()}` },
  );
}
```

Pass `nextCursor` back as `cursor` without decoding or modifying it. Backend services should cache
the application JWT through the SDK instance and must never forward the application client secret to
a browser.
