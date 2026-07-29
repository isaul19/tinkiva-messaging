# Despliegue de la bandeja de conversaciones

Fecha: 2026-07-26  
Entorno: `dev`  
Región: `us-east-1`

## Resultado

La bandeja de Storagia usa la integración manual de WhatsApp. No depende de Embedded Signup ni de
que Tinkiva sea Tech Provider.

El flujo desplegado es:

1. Meta entrega los webhooks al gateway.
2. El gateway identifica la aplicación, el tenant y la integración.
3. Los mensajes se guardan en DynamoDB bajo una conversación determinística.
4. Storagia consulta el gateway mediante su BFF; el navegador nunca recibe el token de Meta ni el
   secreto del cliente del gateway.
5. Las respuestas se encolan con `POST /v1/messages` y se envían a WhatsApp de forma asíncrona.

## Recursos AWS

No se creó un recurso AWS nuevo para esta función. Se reutilizaron:

- Stack: `tinkiva-messaging-gateway-dev`.
- HTTP API: `https://2myga1gnfl.execute-api.us-east-1.amazonaws.com`.
- Lambda privada: `tinkiva-messaging-gateway-dev-privateApi`.
- Tabla de control: `messaging-control-dev`.
- Tabla de datos del stage `dev`.
- Índice disperso existente `GSI1` de la tabla de control.

Se añadieron dos rutas a la HTTP API y a la misma Lambda privada:

```text
GET /v1/tenants/{tenantId}/conversations
GET /v1/tenants/{tenantId}/conversations/{conversationId}/messages
```

Por tanto, para replicar la infraestructura en otro entorno basta desplegar el mismo
`serverless.yml`; no se necesita crear tablas o Lambdas manualmente.

## Modelo del índice

Cada conversación mantiene los siguientes atributos en la tabla de control:

```text
PK      = CONVERSATION#{conversationId}
SK      = META
GSI1PK  = APPLICATION#{applicationId}#TENANT#{tenantId}#INTEGRATION#{integrationId}#CONVERSATIONS
GSI1SK  = {lastMessageAt}#{conversationId}
```

El índice permite listar de forma paginada y descendente únicamente las conversaciones que
pertenecen a la aplicación, tenant e integración autenticados.

Los mensajes continúan en la tabla de datos:

```text
PK = CONVERSATION#{conversationId}
SK = MESSAGE#{occurredAt}#{messageId}
```

## Comandos reproducibles

Validar y empaquetar:

```powershell
pnpm verify
pnpm package
```

Desplegar:

```powershell
pnpm exec serverless deploy --stage dev
```

Descubrir el nombre físico de la tabla:

```powershell
aws cloudformation describe-stack-resource `
  --stack-name tinkiva-messaging-gateway-dev `
  --logical-resource-id MessagingControlTable `
  --region us-east-1 `
  --query StackResourceDetail.PhysicalResourceId `
  --output text
```

Simular el backfill de conversaciones creadas por versiones anteriores:

```powershell
pnpm admin:backfill-conversation-index -- `
  --table messaging-control-dev `
  --region us-east-1
```

Aplicarlo únicamente si `wouldUpdate` es mayor que cero:

```powershell
pnpm admin:backfill-conversation-index -- `
  --table messaging-control-dev `
  --region us-east-1 `
  --apply
```

El comando es idempotente. En el despliegue de 2026-07-26 encontró dos conversaciones y ninguna
necesitó actualización.

## Endpoints privados

Todos requieren un JWT del gateway. Las consultas usan `messages:read`; el borrado usa
`messages:send`.

### Listar conversaciones

```http
GET /v1/tenants/{tenantId}/conversations?integrationId={integrationId}&limit=25&cursor={cursor}
Authorization: Bearer {accessToken}
```

`cursor` es opcional y opaco. No debe modificarse ni reconstruirse en el cliente.

Respuesta:

```json
{
  "tenantId": "tenant_...",
  "items": [
    {
      "conversationId": "conv_...",
      "createdAt": "2026-07-26T10:00:00.000Z",
      "integrationId": "int_...",
      "lastMessageAt": "2026-07-26T10:01:00.000Z",
      "participant": {
        "displayName": "Cliente",
        "phoneNumber": "51999888777"
      },
      "provider": "WHATSAPP",
      "status": "OPEN",
      "lastMessage": {
        "conversationId": "conv_...",
        "direction": "INBOUND",
        "integrationId": "int_...",
        "messageId": "msg_...",
        "occurredAt": "2026-07-26T10:01:00.000Z",
        "provider": "WHATSAPP",
        "status": "RECEIVED",
        "text": "Hola",
        "type": "TEXT"
      }
    }
  ],
  "nextCursor": "cursor-opaco"
}
```

### Listar mensajes

```http
GET /v1/tenants/{tenantId}/conversations/{conversationId}/messages?limit=50&cursor={cursor}
Authorization: Bearer {accessToken}
```

Cada página se devuelve en orden cronológico. La primera consulta obtiene los mensajes más
recientes; `nextCursor` permite cargar páginas anteriores.

### Eliminar una conversación

```http
DELETE /v1/tenants/{tenantId}/conversations/{conversationId}
Authorization: Bearer {accessToken}
```

La operación es idempotente y responde `204 No Content`. Elimina únicamente el metadato, los
mensajes y las referencias locales de Tinkiva Messaging. No intenta eliminar mensajes ya entregados
en WhatsApp. El siguiente mensaje para el mismo destinatario crea de nuevo la conversación sin el
historial eliminado.

### Responder

Se reutiliza el endpoint de envío:

```http
POST /v1/messages
Authorization: Bearer {accessToken}
Content-Type: application/json
Idempotency-Key: {uuid-estable-por-intento}
```

```json
{
  "tenantId": "tenant_...",
  "integrationId": "int_...",
  "conversationId": "conv_...",
  "content": {
    "type": "TEXT",
    "text": {
      "body": "Hola, ¿en qué podemos ayudarte?"
    }
  }
}
```

## Storagia

Backend dev:

```text
https://v7qdrapbuh.execute-api.us-east-1.amazonaws.com
```

Rutas BFF:

```text
GET  /api/v1/messaging/whatsapp/status
GET  /api/v1/messaging/conversations
GET  /api/v1/messaging/conversations/{conversationId}/messages
POST /api/v1/messaging/conversations/{conversationId}/messages
```

Frontend dev:

```text
https://storagia.dev.tinkiva.com/messaging/conversations
```

La bandeja consulta cada diez segundos las conversaciones y cada ocho segundos el hilo seleccionado.
Una evolución futura puede sustituir el sondeo por eventos en tiempo real sin cambiar los contratos
públicos.

## Verificación del despliegue

La prueba en vivo confirmó:

- Integración manual de WhatsApp activa.
- Una conversación visible.
- Cuatro mensajes recuperados en el primer hilo.
- Aislamiento por `applicationId`, `tenantId` e `integrationId`.

No se imprimieron ni almacenaron tokens durante la prueba.
