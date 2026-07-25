# Initial TypeScript SDK usage

The initial in-repository SDK is exported from `src/sdk/index.ts`. It acquires and caches a
short-lived JWT, validates gateway responses, sends the idempotency header, and never requires a
provider credential.

```ts
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

import { MessagingGatewayClient } from "./src/sdk/index.js";

const secrets = new SecretsManagerClient({ region: "us-east-1" });

const messaging = new MessagingGatewayClient({
  clientId: "msgc_...",
  gatewayUrl: "https://2myga1gnfl.execute-api.us-east-1.amazonaws.com",
  getClientSecret: async () => {
    const result = await secrets.send(
      new GetSecretValueCommand({
        SecretId: "/tinkiva/messaging/dev/applications/storagia/client",
      }),
    );
    const credentials = JSON.parse(result.SecretString ?? "{}") as {
      clientSecret?: string;
    };

    if (credentials.clientSecret === undefined) {
      throw new Error("Messaging client secret is missing.");
    }

    return credentials.clientSecret;
  },
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

Only backend services may use the application client secret. A consuming AWS workload should receive
`secretsmanager:GetSecretValue` only for its own credentials secret.
