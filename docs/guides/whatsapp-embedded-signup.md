# WhatsApp Embedded Signup

Embedded Signup lets a Storagia company connect its own WhatsApp assets from a Meta-hosted dialog.
The customer never copies an App Secret or access token. The browser receives a one-time
authorization code and the selected asset IDs; Tinkiva Messaging exchanges the code server-side,
validates it, encrypts the resulting credential with KMS, configures the WABA webhook, and activates
the tenant integration.

The manual registration and credential-rotation endpoints remain available as an operational
fallback.

## Architecture

```text
Storagia browser
  -> Storagia backend/BFF
      -> Tinkiva Messaging Gateway
  -> Meta Facebook JavaScript SDK
      -> one-time code + WABA/phone/business IDs
  -> Storagia backend/BFF
      -> Tinkiva Messaging Gateway
          -> Meta token exchange and validation
          -> DynamoDB ciphertext encrypted by KMS
          -> WABA webhook subscription and activation
```

Do not put the Messaging Gateway `clientSecret`, its application JWT, the Meta App Secret, or the
resulting Meta token in browser storage. The Storagia backend/BFF owns the gateway SDK and exposes
only tenant-authorized application endpoints to the browser.

## One-time Meta setup

Tinkiva must configure its Meta app once:

1. Add or open **Facebook Login for Business** in the Meta app.
2. Enable Client OAuth Login, Web OAuth Login, HTTPS enforcement, strict redirect URI mode, Embedded
   Browser OAuth Login, and Login with the JavaScript SDK.
3. Add every exact HTTPS Storagia portal domain to both **Allowed Domains for the JavaScript SDK**
   and **Valid OAuth Redirect URIs**.
4. Create a configuration from the **WhatsApp Embedded Signup** template. Request only the WhatsApp
   assets and the `whatsapp_business_management` and `whatsapp_business_messaging` permissions.
5. Copy the numeric **Configuration ID**. It is not the Meta App ID.
6. Keep the app in development mode while testing only with app admins/developers/testers. Before
   onboarding unrelated customer businesses, complete Business Verification, App Review, Tech
   Provider onboarding, and Advanced Access required by Meta.

Meta's current v4 implementation is configuration-driven. The frontend therefore sends
`extras: { setup: {} }`; it does not hard-code a legacy `sessionInfoVersion`.

Primary references:

- [Meta Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation/)
- [Meta Embedded Signup API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup)

## Configure the gateway

Deploy the code first, then run this command once after Meta generates the Configuration ID:

```powershell
pnpm admin:configure-whatsapp-embedded-signup `
  --app-id 1393451145991555 `
  --configuration-id 1563719192007796 `
  --source-provider-connection-id pc_01KYDYA1NRJ6RX68XFZ63YFRFV `
  --stage dev `
  --region us-east-1
```

The command decrypts the App Secret from the existing WhatsApp test connection only in process
memory and re-encrypts it as the platform Embedded Signup configuration. It never prints the secret.
The resulting DynamoDB item is:

```text
PK=PLATFORM#WHATSAPP
SK=EMBEDDED_SIGNUP
```

It stores public App/Configuration IDs and KMS ciphertext for the central Tinkiva Meta App Secret.
This uses the existing control table and KMS key; it creates no Secrets Manager secret and no new
monthly per-secret charge. Re-running the command updates the configuration and increments
`configurationVersion`.

## Gateway endpoints

Both endpoints require a gateway JWT with `integrations:write` and verify that the tenant belongs to
the authenticated application.

### Read browser-safe configuration

```http
GET /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup/config
Authorization: Bearer <application-access-token>
```

Before central configuration:

```json
{
  "configured": false,
  "graphApiVersion": "v25.0"
}
```

After central configuration:

```json
{
  "appId": "1393451145991555",
  "configurationId": "1563719192007796",
  "configured": true,
  "graphApiVersion": "v25.0"
}
```

These values are safe to send to the browser. The App Secret is never returned or read for this GET.

### Complete tenant onboarding

The one-time code currently has a very short lifetime, so the browser must forward it immediately.

```http
POST /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup
Authorization: Bearer <application-access-token>
Content-Type: application/json
```

```json
{
  "authorizationCode": "<one-time-code-from-FB.login>",
  "businessPortfolioId": "<business_id-from-message-event>",
  "displayName": "WhatsApp de la empresa",
  "phoneNumberId": "<phone_number_id-from-message-event>",
  "wabaId": "<waba_id-from-message-event>"
}
```

`businessPortfolioId` is optional. A successful request returns `201` with the same secret-free
integration response as manual registration.

The gateway exchanges the code using the central Meta App Secret, checks that Meta issued the token
to Tinkiva's app with both required WhatsApp permissions, verifies that the phone belongs to the
selected WABA, creates the isolated tenant credential, subscribes the app, configures the
tenant-specific callback, and returns the active integration.

## Storagia backend/BFF

Use the repository SDK in the Storagia server:

```ts
import { MessagingGatewayClient } from "@tinkiva/messaging-gateway";

const messaging = new MessagingGatewayClient({
  clientId: process.env.TINKIVA_MESSAGING_CLIENT_ID!,
  gatewayUrl: process.env.TINKIVA_MESSAGING_GATEWAY_URL!,
  getClientSecret: async () => process.env.TINKIVA_MESSAGING_CLIENT_SECRET!,
});

export const getWhatsappSignupConfiguration = (tenantId: string) =>
  messaging.getWhatsappEmbeddedSignupConfiguration(tenantId);

export const completeWhatsappSignup = (
  tenantId: string,
  input: {
    authorizationCode: string;
    businessPortfolioId?: string;
    displayName: string;
    phoneNumberId: string;
    wabaId: string;
  },
) => messaging.completeWhatsappEmbeddedSignup(tenantId, input);
```

In production, read the Storagia gateway client secret from its server-side secret store rather than
an `.env` committed to source control. The BFF must derive `tenantId` from the authenticated
Storagia company; never accept an arbitrary tenant ID without an ownership check.

## Storagia frontend

Load the SDK once:

```html
<script
  async
  defer
  crossorigin="anonymous"
  src="https://connect.facebook.net/en_US/sdk.js"
></script>
```

Initialize it after fetching the public configuration from the Storagia BFF:

```ts
FB.init({
  appId: configuration.appId,
  autoLogAppEvents: true,
  xfbml: true,
  version: configuration.graphApiVersion,
});
```

The button must coordinate two asynchronous results: the exchangeable `code` from `FB.login` and the
asset IDs from the `WA_EMBEDDED_SIGNUP` window message.

```ts
type SignupResult = {
  authorizationCode: string;
  businessPortfolioId?: string;
  phoneNumberId: string;
  wabaId: string;
};

const allowedMetaOrigins = new Set(["https://www.facebook.com", "https://web.facebook.com"]);

export function launchWhatsappSignup(configuration: {
  configurationId: string;
}): Promise<SignupResult> {
  return new Promise((resolve, reject) => {
    let authorizationCode: string | undefined;
    let assets:
      | {
          businessPortfolioId?: string;
          phoneNumberId: string;
          wabaId: string;
        }
      | undefined;

    const finish = () => {
      if (authorizationCode === undefined || assets === undefined) return;
      window.removeEventListener("message", onMessage);
      resolve({ authorizationCode, ...assets });
    };

    const onMessage = (event: MessageEvent) => {
      if (!allowedMetaOrigins.has(event.origin) || typeof event.data !== "string") return;

      try {
        const message = JSON.parse(event.data);
        if (message.type !== "WA_EMBEDDED_SIGNUP") return;

        if (message.event === "FINISH") {
          assets = {
            businessPortfolioId: message.data.business_id,
            phoneNumberId: message.data.phone_number_id,
            wabaId: message.data.waba_id,
          };
          finish();
        } else if (message.event === "CANCEL" || message.event === "ERROR") {
          window.removeEventListener("message", onMessage);
          reject(new Error("El registro de WhatsApp no fue completado."));
        }
      } catch {
        // The Facebook SDK also sends unrelated non-JSON window messages.
      }
    };

    window.addEventListener("message", onMessage);
    FB.login(
      (response: { authResponse?: { code?: string } }) => {
        const code = response.authResponse?.code;
        if (code === undefined) {
          window.removeEventListener("message", onMessage);
          reject(new Error("Meta no devolvió el código de autorización."));
          return;
        }

        authorizationCode = code;
        finish();
      },
      {
        config_id: configuration.configurationId,
        extras: { setup: {} },
        override_default_response_type: true,
        response_type: "code",
      },
    );
  });
}
```

The page flow is:

1. Call the Storagia BFF configuration endpoint.
2. Disable the button when `configured` is false or while another attempt is running.
3. Initialize `FB` and call `launchWhatsappSignup` only from a user click so popup blockers allow
   it.
4. Immediately POST the returned values and the chosen display name to the Storagia BFF.
5. Show success only after the BFF returns the `ACTIVE` integration.
6. On cancellation, allow a retry. On a gateway `400`, restart the Meta flow because the code is
   single-use/expired. On `409`, show the provider configuration or WABA uniqueness error.

Do not log the authorization code. Never send it to analytics, error trackers, query strings, or
local storage.

## Current limitations

- The current gateway intentionally accepts only successful `FINISH` sessions containing one WABA
  and one Phone Number ID.
- `FINISH_ONLY_WABA`, multi-WABA selection, coexistence/onboarding of an existing WhatsApp Business
  App number, templates, and media require separate implementation.
- One WABA is currently reserved for one gateway integration to prevent a tenant callback from
  overwriting another.
