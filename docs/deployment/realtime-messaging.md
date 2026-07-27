# Mensajería en tiempo real

Fecha de implementación: 2026-07-26  
Entorno inicial: `dev`  
Región: `us-east-1`

## Resultado desplegado

```text
Stack:          tinkiva-messaging-gateway-dev
HTTP API:       https://2myga1gnfl.execute-api.us-east-1.amazonaws.com
WebSocket API:  wss://u854ghkv5h.execute-api.us-east-1.amazonaws.com/dev
Data table:     messaging-data-dev
Event queue:    messaging-app-events-dev.fifo
```

Storagia quedó desplegado en:

```text
Backend:  https://v7qdrapbuh.execute-api.us-east-1.amazonaws.com
Frontend: https://storagia.dev.tinkiva.com
```

## Objetivo

Storagia recibe nuevos mensajes y cambios de estado sin recargar la bandeja. La conexión es
multi-tenant y no expone el JWT del gateway, las credenciales del cliente M2M ni los tokens de
WhatsApp.

El flujo es:

1. El frontend solicita un ticket a su propio backend.
2. El backend de Storagia usa su cliente M2M para pedir al gateway un ticket opaco de 60 segundos.
3. El navegador abre el WebSocket con ese ticket. El ticket se consume de forma atómica y no puede
   reutilizarse.
4. DynamoDB Streams detecta mensajes nuevos y cambios reales de estado.
5. El proyector publica un evento normalizado en la FIFO existente `AppEventsQueue`.
6. El dispatcher entrega el evento únicamente a las conexiones de la aplicación y tenant
   correspondientes.
7. React Query modifica el mensaje y la conversación afectados. El sondeo HTTP solo permanece como
   respaldo cuando el WebSocket está desconectado.

## Recursos administrados por Serverless Framework

No se crea infraestructura manualmente. `serverless.yml` y sus archivos incluidos crean o
actualizan:

- Un API Gateway WebSocket con stage `${sls:stage}` y rutas `$connect`, `$disconnect`, `$default` y
  `ping`.
- Lambda `appEventProjector`, conectada al stream de la tabla de datos.
- Lambda `realtimeConnection`, que consume tickets y administra conexiones.
- Lambda `realtimeDispatcher`, conectada a `AppEventsQueue`.
- Roles IAM y grupos de logs dedicados para esas Lambdas.
- `StreamSpecification: NEW_AND_OLD_IMAGES` en la tabla de datos existente.

Se reutilizan:

- La tabla de control para tickets y conexiones con TTL.
- La tabla de datos y su cifrado.
- `AppEventsQueue` y `AppEventsDlq`.
- El autorizador JWT de la HTTP API privada.

No se añade otra tabla DynamoDB ni otra cola SQS.

## Claves de DynamoDB

El ticket solo se almacena como SHA-256:

```text
PK = REALTIME_TICKET#{ticketDigest}
SK = META
```

Una conexión autenticada mantiene dos índices:

```text
PK = REALTIME_SCOPE#{applicationId}#TENANT#{tenantId}
SK = CONNECTION#{connectionId}

PK = REALTIME_CONNECTION#{connectionId}
SK = META
```

Todos los registros tienen `expiresAtEpochSeconds`; DynamoDB TTL realiza la limpieza diferida y
`$disconnect` intenta eliminar ambos índices inmediatamente.

## Endpoints y payloads

### Crear ticket

Endpoint privado del gateway:

```http
POST /v1/tenants/{tenantId}/realtime/tickets
Authorization: Bearer {gatewayJwt}
```

Scope requerido: `messages:read`.

Respuesta `201`:

```json
{
  "expiresAt": "2026-07-26T04:01:00.000Z",
  "ticket": "rt_valor_opaco_de_un_solo_uso",
  "websocketUrl": "wss://{apiId}.execute-api.us-east-1.amazonaws.com/dev"
}
```

Endpoint BFF de Storagia:

```http
POST /api/v1/messaging/realtime-ticket
Cookie: access_token={sesionStoragia}
```

El frontend conecta así:

```text
wss://{apiId}.execute-api.us-east-1.amazonaws.com/dev?ticket={ticket}
```

Heartbeat opcional:

```json
{ "action": "ping" }
```

Respuesta:

```json
{ "type": "pong" }
```

### Evento recibido

```json
{
  "applicationId": "app_...",
  "data": {
    "conversationId": "conv_...",
    "integrationId": "int_...",
    "message": {
      "conversationId": "conv_...",
      "direction": "INBOUND",
      "integrationId": "int_...",
      "messageId": "msg_...",
      "occurredAt": "2026-07-26T04:00:00.000Z",
      "provider": "WHATSAPP",
      "status": "RECEIVED",
      "text": "Hola",
      "type": "TEXT"
    }
  },
  "eventId": "evt_...",
  "occurredAt": "2026-07-26T04:00:00.000Z",
  "schemaVersion": 1,
  "tenantId": "tenant_...",
  "type": "message.received"
}
```

Tipos posibles: `message.received`, `message.queued`, `message.sent`, `message.delivered`,
`message.read` y `message.failed`.

## Comandos reproducibles

Validar:

```powershell
pnpm verify
pnpm package
```

Desplegar o actualizar:

```powershell
pnpm exec serverless deploy --stage dev
```

Consultar outputs:

```powershell
aws cloudformation describe-stacks `
  --stack-name tinkiva-messaging-gateway-dev `
  --region us-east-1 `
  --query "Stacks[0].Outputs"
```

Desplegar Storagia después del gateway:

```powershell
Set-Location C:\Proyectos\StoragIA\Backend
pnpm run ci
pnpm run serverless-deploy-dev

Set-Location C:\Proyectos\StoragIA\Frontend
pnpm run lint
pnpm run serverless-deploy-dev
```

## Costos y límites

API Gateway WebSocket cobra por conexiones-minuto y mensajes. Las tres Lambdas y el stream son
serverless y pagan por uso. Al reutilizar DynamoDB y SQS se evitan costos mínimos de recursos
adicionales; el tráfico, lecturas, escrituras e invocaciones sí se facturan normalmente.

Una conexión expira a las 125 minutos, que coincide con el máximo de API Gateway WebSocket. El
frontend renueva el ticket y reconecta con backoff exponencial.

## Rollback

Desplegar la versión anterior elimina las rutas, Lambdas y API WebSocket administradas por
CloudFormation. La tabla de datos puede conservar el stream sin afectar lectores anteriores. Los
registros `REALTIME_*` son efímeros y se eliminan por TTL; no contienen mensajes ni credenciales
recuperables.
