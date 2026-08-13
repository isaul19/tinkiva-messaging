# Engineering documentation

This directory records how the gateway is designed, created, deployed, and operated. The root
`readme.md` remains the product and architecture specification.

## Contents

- `architecture/`: accepted architecture decisions.
- `deployment/`: reproducible infrastructure and deployment records.
- `guides/`: provider endpoints, payloads, SDK usage, and operational boundaries.
- [AWS resource inventory](./aws-resources.md): every AWS resource used by the gateway, its purpose,
  cost drivers, and review points.
- [WhatsApp API](./guides/whatsapp-api.md)
  - [WhatsApp Embedded Signup](./guides/whatsapp-embedded-signup.md)
- [OpenAI inbound media enrichment](./guides/openai-media-enrichment.md)
- [Application credentials and global administration](./guides/application-client-credentials.md)
- `runbooks/`: operational procedures.
  - [Migrate a tenant between applications](./runbooks/migrate-tenant-application.md)
- `implementation-status.md`: implementation progress against the specification.

No document in this directory may contain provider tokens, client secrets, signing secrets, or
personal message content.
