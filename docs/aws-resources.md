# Inventario de recursos AWS de TinkivaMessaging

Última revisión: 2026-07-31  
Stack principal: `tinkiva-messaging-gateway-${stage}`  
Región predeterminada: `us-east-1`  
Stage inspeccionado en AWS: `dev`

Estado de la nueva cola de automatización: desplegada en `dev` el 2026-07-31. El stack quedó en
`UPDATE_COMPLETE` y sus recursos se verificaron directamente contra SQS, Lambda y CloudWatch.

## Objetivo de este documento

Este documento explica qué recursos AWS utiliza TinkivaMessaging, para qué existe cada uno, cómo se
relacionan y qué puntos conviene revisar desde costo, rendimiento, seguridad y operación.

El inventario se obtuvo de:

- `serverless.yml` y los módulos de `infrastructure/serverless/`;
- la plantilla CloudFormation empaquetada en `.serverless/`;
- el stack activo `tinkiva-messaging-gateway-dev` consultado de forma de solo lectura;
- los clientes AWS utilizados por las Lambdas y los CLI administrativos.

La plantilla objetivo contiene 118 recursos lógicos, incluyendo rutas, integraciones, permisos,
event source mappings y recursos auxiliares creados por Serverless Framework. Los recursos de
aplicación más importantes se resumen a continuación.

## Resumen ejecutivo

| Servicio AWS      |                                   Cantidad base | Uso principal                                                      |
| ----------------- | ----------------------------------------------: | ------------------------------------------------------------------ |
| CloudFormation    |                               1 stack por stage | Desplegar y actualizar toda la infraestructura como una unidad     |
| API Gateway v2    |                                          2 APIs | API HTTP y API WebSocket realtime                                  |
| Lambda            |                      12 funciones de aplicación | API, webhooks, procesamiento, envío y realtime                     |
| Lambda auxiliar   |                                       1 función | Configuración de logging de API Gateway por Serverless Framework   |
| DynamoDB          |                                        2 tablas | Plano de control y datos de mensajes                               |
| DynamoDB Streams  |                                        1 stream | Convertir cambios durables de mensajes en eventos realtime         |
| SQS               |                          6 colas fuente + 6 DLQ | Desacoplamiento, orden, reintentos y recuperación                  |
| S3                |                          1 bucket de aplicación | Imágenes y objetos de medios privados                              |
| KMS               |  1 clave administrada por el proyecto + 1 alias | Cifrar credenciales de Telegram y WhatsApp almacenadas en DynamoDB |
| Secrets Manager   | 2 secretos del stack + 1 por aplicación cliente | Autenticación M2M y firma de JWT                                   |
| IAM               |             12 roles de aplicación + 1 auxiliar | Mínimo privilegio por Lambda                                       |
| CloudWatch Logs   |                                   14 log groups | Logs de Lambdas, WebSocket y recurso auxiliar                      |
| CloudWatch Alarms |                                       6 alarmas | Detectar mensajes en las DLQ                                       |
| SNS               |            1 topic + suscripción email opcional | Distribuir alertas operativas                                      |
| S3 de despliegue  |            1 bucket compartido, fuera del stack | Guardar artefactos ZIP de Serverless Framework                     |

No hay recursos EC2, ECS, EKS, RDS, ElastiCache, VPC, NAT Gateway, Load Balancer ni CloudFront en
este stack. El gateway es serverless y no depende de la red ni de la base de datos del backend
principal.

## Vista general de la arquitectura

### Mensajes entrantes

```text
Telegram / Meta
      |
      v
API Gateway HTTP
      |
      v
telegramWebhook / whatsappWebhook
      |
      v
InboundQueue.fifo
      |
      v
inboundProcessor
      |---------------------> S3 (imágenes)
      v
DynamoDB control + data
```

### Mensajes salientes

```text
Backend principal
      |
      v
API Gateway HTTP -> apiAuthorizer -> privateApi
                                      |
                     +----------------+----------------+
                     |                                 |
                     v                                 v
       TelegramOutboundQueue.fifo       WhatsappOutboundQueue.fifo
                     |                                 |
                     v                                 v
              telegramSender                   whatsappSender
                     |                                 |
                     v                                 v
                 Telegram                         Meta Graph API
```

### Eventos realtime y automatización

```text
MessagingDataTable Stream
          |
          v
  appEventProjector
          |
          +-----------------------------+
          |                             |
          v                             v
  AppEventsQueue.fifo     StoragiaAutomationQueue.fifo
          |                             |
          v                             v
 realtimeDispatcher       Consumidor Nest en EC2 de StoragIA
          |
          v
API Gateway Management API -> conexiones WebSocket del navegador
```

El segundo destino recibe únicamente eventos `message.received`, con dirección `INBOUND`, cuyo
`applicationId` coincide con `STORAGIA_AUTOMATION_APPLICATION_ID`. No se realizan llamadas HTTP
desde TinkivaMessaging hacia EC2.

## 1. CloudFormation y Serverless Framework

Toda la infraestructura de un entorno se administra mediante un stack llamado
`tinkiva-messaging-gateway-${stage}`. `serverless.yml` compone los archivos de
`infrastructure/serverless/` y Serverless Framework genera la plantilla final.

Configuración general de las Lambdas:

- Node.js 22;
- arquitectura ARM64;
- 512 MB de memoria por defecto;
- paquetes ZIP individuales, no imágenes Docker;
- sourcemaps habilitados;
- logs con retención de 14 días;
- sin versiones persistentes de funciones (`versionFunctions: false`);
- sin provisioned concurrency;
- despliegue directo mediante Serverless Framework.

Serverless utiliza además un bucket regional compartido para almacenar los ZIP de despliegue. En el
paquete inspeccionado aparece `serverless-framework-deployments-us-east-1-...`. Ese bucket no
pertenece al stack de TinkivaMessaging y puede contener artefactos de otros servicios desplegados
con la misma instalación de Serverless Framework.

## 2. API Gateway HTTP

Recurso principal: `HttpApi` (`AWS::ApiGatewayV2::Api`).

Su propósito es exponer la API M2M, los webhooks de proveedores y el endpoint de salud. Tiene 19
rutas HTTP agrupadas así:

### Rutas públicas

| Método y ruta                          | Lambda            | Propósito                                          |
| -------------------------------------- | ----------------- | -------------------------------------------------- |
| `GET /health`                          | `health`          | Liveness sin revelar detalles internos             |
| `POST /v1/auth/token`                  | `authToken`       | Intercambiar `clientId/clientSecret` por JWT corto |
| `POST /webhooks/telegram/{webhookKey}` | `telegramWebhook` | Recibir actualizaciones de Telegram                |
| `GET /webhooks/whatsapp/{webhookKey}`  | `whatsappWebhook` | Verificación inicial del webhook de Meta           |
| `POST /webhooks/whatsapp/{webhookKey}` | `whatsappWebhook` | Recibir mensajes y estados de WhatsApp             |

Los webhooks son públicamente alcanzables, pero validan claves, secretos o firmas del proveedor.

### Rutas protegidas por el authorizer

| Método y ruta                                                                  | Propósito                                |
| ------------------------------------------------------------------------------ | ---------------------------------------- |
| `POST /v1/tenants`                                                             | Crear o asegurar el vínculo de un tenant |
| `GET /v1/tenants/by-external-account/{externalAccountId}`                      | Resolver tenant por cuenta externa       |
| `GET /v1/tenants/{tenantId}`                                                   | Consultar tenant                         |
| `GET /v1/tenants/{tenantId}/integrations`                                      | Listar integraciones                     |
| `POST /v1/tenants/{tenantId}/integrations/telegram`                            | Registrar bot de Telegram                |
| `POST /v1/tenants/{tenantId}/integrations/whatsapp`                            | Registrar integración de WhatsApp        |
| `GET /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup/config`      | Obtener configuración de Embedded Signup |
| `POST /v1/tenants/{tenantId}/integrations/whatsapp/embedded-signup`            | Completar Embedded Signup                |
| `PUT /v1/tenants/{tenantId}/integrations/whatsapp/{integrationId}/credentials` | Rotar credenciales de WhatsApp           |
| `GET /v1/tenants/{tenantId}/conversations`                                     | Listar conversaciones                    |
| `GET /v1/tenants/{tenantId}/conversations/{conversationId}/messages`           | Listar mensajes                          |
| `DELETE /v1/tenants/{tenantId}/conversations/{conversationId}`                 | Eliminar conversación                    |
| `POST /v1/tenants/{tenantId}/realtime/tickets`                                 | Crear ticket WebSocket de un solo uso    |
| `POST /v1/messages`                                                            | Encolar un mensaje saliente              |

El authorizer usa el header `Authorization`, respuestas simples v2 y actualmente tiene
`resultTtlInSeconds: 0`. Por tanto, API Gateway no almacena en caché el resultado de autorización:
cada llamada protegida invoca `apiAuthorizer`. Esto maximiza la inmediatez de revocaciones, pero
añade una invocación Lambda y una lectura DynamoDB a cada request privado.

CORS está deshabilitado. Esto es correcto mientras los navegadores no llamen directamente a la API
M2M y todo pase por el backend principal.

## 3. API Gateway WebSocket

Recurso principal: `WebsocketsApi`, con nombre físico `tinkiva-messaging-realtime-${stage}`.

La selección de ruta usa `$request.body.action`. Sus cuatro rutas son:

| Ruta          | Propósito                                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| `$connect`    | Consumir un ticket de un solo uso y registrar la conexión por aplicación/tenant |
| `$disconnect` | Eliminar los registros de conexión                                              |
| `ping`        | Responder `pong` para verificar que la conexión sigue viva                      |
| `$default`    | Respuesta controlada para acciones no reconocidas                               |

También se crean un deployment, un stage, una integración Lambda, dos route responses y el permiso
para que API Gateway invoque `realtimeConnection`.

`realtimeDispatcher` utiliza `execute-api:ManageConnections` para publicar eventos mediante el
endpoint de administración de API Gateway. El logging del WebSocket está configurado en nivel
`ERROR` y no incluye el contenido completo de las solicitudes.

## 4. Funciones Lambda

| Lambda               | Trigger                         | Recursos principales                             | Propósito                                                               |
| -------------------- | ------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| `health`             | HTTP `GET /health`              | CloudWatch Logs                                  | Confirmar que el gateway responde                                       |
| `authToken`          | HTTP `POST /v1/auth/token`      | ControlTable, AuthPepperSecret, JwtSigningSecret | Validar credenciales M2M y emitir JWT de 15 minutos                     |
| `apiAuthorizer`      | Authorizer HTTP                 | ControlTable, JwtSigningSecret                   | Verificar JWT, estado actual del cliente y scopes                       |
| `privateApi`         | 14 rutas HTTP privadas          | Ambas tablas, KMS, S3, colas outbound            | Tenants, integraciones, conversaciones, tickets y envío de mensajes     |
| `telegramWebhook`    | Webhook HTTP                    | ControlTable, KMS, InboundQueue                  | Validar Telegram y encolar updates                                      |
| `whatsappWebhook`    | Webhook HTTP                    | ControlTable, KMS, InboundQueue                  | Validar Meta y encolar mensajes/estados                                 |
| `inboundProcessor`   | InboundQueue, batch 10          | Ambas tablas, KMS, S3                            | Normalizar, deduplicar, importar medios y persistir mensajes entrantes  |
| `appEventProjector`  | DynamoDB Stream, batch 100      | DataTable Stream, S3, ambas colas de eventos     | Proyectar cambios; publicar realtime y mensajes entrantes para StoragIA |
| `realtimeConnection` | Rutas WebSocket                 | ControlTable                                     | Consumir tickets y mantener conexiones por tenant                       |
| `realtimeDispatcher` | AppEventsQueue, batch 10        | ControlTable, WebSocket Management API           | Enviar eventos a conexiones activas y limpiar conexiones expiradas      |
| `telegramSender`     | TelegramOutboundQueue, batch 10 | Ambas tablas, KMS, S3                            | Enviar a Telegram y actualizar el estado durable                        |
| `whatsappSender`     | WhatsappOutboundQueue, batch 10 | Ambas tablas, KMS, S3                            | Enviar a Meta y actualizar el estado durable                            |

Los consumidores SQS y DynamoDB Stream devuelven partial batch responses. Un registro fallido puede
reintentarse sin repetir obligatoriamente todo el batch.

Serverless crea cinco `AWS::Lambda::EventSourceMapping`:

1. `InboundQueue -> inboundProcessor`;
2. `TelegramOutboundQueue -> telegramSender`;
3. `WhatsappOutboundQueue -> whatsappSender`;
4. `MessagingDataTable Stream -> appEventProjector`;
5. `AppEventsQueue -> realtimeDispatcher`.

Además existe una Lambda auxiliar de Serverless Framework para configurar el rol de CloudWatch de
API Gateway. No contiene lógica de negocio de mensajería.

## 5. DynamoDB

Las dos tablas usan capacidad `PAY_PER_REQUEST`, claves compuestas `PK/SK`, TTL en `expiresAt` y
cifrado KMS administrado por DynamoDB. En `prod` se habilitan point-in-time recovery y deletion
protection; en otros stages ambas protecciones están deshabilitadas.

### `messaging-control-${stage}`

Propósito: plano de control y relaciones necesarias para operar el gateway.

Contiene, entre otros:

- aplicaciones y clientes M2M;
- tenants y vínculos entre aplicación/cuenta externa/tenant;
- integraciones de Telegram y WhatsApp;
- credenciales de proveedores cifradas como ciphertext;
- identidades, aliases y conversaciones;
- registros de idempotencia;
- referencias auxiliares de mensajes;
- configuración de WhatsApp Embedded Signup;
- tickets realtime y conexiones WebSocket.

Tiene un índice `GSI1` con `GSI1PK/GSI1SK`, proyección `ALL`, utilizado para consultas como código
de aplicación, clientes, integraciones y conversaciones por tenant.

### `messaging-data-${stage}`

Propósito: historial durable de mensajes y cambios de estado.

Contiene:

- mensajes entrantes y salientes;
- contenido normalizado de texto o referencias de media;
- estado `QUEUED`, `SENT`, `DELIVERED`, `READ`, `FAILED` o `RECEIVED`;
- referencias por `messageId` hacia la conversación y sort key real.

Tiene DynamoDB Streams con vista `NEW_AND_OLD_IMAGES`. El stream permite detectar inserts y cambios
reales de estado sin consultar periódicamente la tabla.

## 6. SQS y DLQ

Todas las colas fuente retienen mensajes durante 345600 segundos (4 días), usan long polling de 20
segundos y redirigen a su DLQ después de 5 recepciones fallidas. Las DLQ retienen mensajes durante
1209600 segundos (14 días). Todas usan cifrado administrado por SQS.

| Cola fuente                                   | Tipo     | Visibility timeout | Productor                  | Consumidor              | Uso                                             |
| --------------------------------------------- | -------- | -----------------: | -------------------------- | ----------------------- | ----------------------------------------------- |
| `messaging-inbound-events-${stage}.fifo`      | FIFO     |              180 s | Webhooks Telegram/WhatsApp | `inboundProcessor`      | Updates verificados de proveedores              |
| `messaging-outbound-telegram-${stage}.fifo`   | FIFO     |              180 s | `privateApi`               | `telegramSender`        | Comandos salientes hacia Telegram               |
| `messaging-outbound-whatsapp-${stage}.fifo`   | FIFO     |              180 s | `privateApi`               | `whatsappSender`        | Comandos salientes hacia Meta                   |
| `messaging-app-events-${stage}.fifo`          | FIFO     |              180 s | `appEventProjector`        | `realtimeDispatcher`    | Eventos normalizados para WebSocket             |
| `messaging-storagia-automation-${stage}.fifo` | FIFO     |              300 s | `appEventProjector`        | Nest en EC2 de StoragIA | Mensajes entrantes para automatización          |
| `messaging-media-${stage}`                    | Standard |              360 s | Ninguno actualmente        | Ninguno actualmente     | Cola reservada para trabajo asíncrono de medios |

Las cinco colas FIFO deshabilitan content-based deduplication y proporcionan explícitamente
`MessageDeduplicationId`. Usan deduplicación y throughput por `MessageGroupId`, conservando orden
por conversación o destino sin serializar todo el sistema.

Cada cola tiene su DLQ correspondiente:

- `messaging-inbound-events-dlq-${stage}.fifo`;
- `messaging-outbound-telegram-dlq-${stage}.fifo`;
- `messaging-outbound-whatsapp-dlq-${stage}.fifo`;
- `messaging-app-events-dlq-${stage}.fifo`;
- `messaging-storagia-automation-dlq-${stage}.fifo`;
- `messaging-media-dlq-${stage}`.

La cola de StoragIA conserva el mismo contrato `RealtimeMessageEvent`, usa `eventId` para
deduplicación y agrupa por `applicationId:tenantId:conversationId`. TinkivaMessaging no crea un
event source mapping ni un consumidor Lambda para ella. El role de EC2 se administra fuera de este
stack.

### Outputs de automatización

El stack expone cuatro valores para configurar el consumidor externo sin hardcodear recursos:

- `StoragiaAutomationQueueUrl`;
- `StoragiaAutomationQueueArn`;
- `StoragiaAutomationDlqUrl`;
- `StoragiaAutomationDlqArn`.

### Estado especial de `MediaQueue`

`MediaQueue`, `MediaDlq`, su output y su alarma están desplegados, pero actualmente ningún archivo
de `src/` publica ni consume esa cola. La importación de imágenes se realiza sincrónicamente en
`privateApi` o `inboundProcessor`.

Debe tomarse una decisión explícita:

- conservarla porque se implementará un `mediaWorker` próximamente; o
- eliminar `MediaQueue`, `MediaDlq`, `MediaDlqAlarm` y `MediaQueueUrl` para reducir superficie
  operativa.

## 7. S3

Bucket: `tinkiva-messaging-media-${stage}-${AWS::AccountId}`.

Uso:

- almacenar imágenes entrantes descargadas desde Telegram o Meta;
- almacenar imágenes salientes importadas por URL o subidas previamente;
- generar URLs firmadas temporales para envío y visualización;
- reservar el prefijo `raw-events/` para eventos crudos temporales.

Controles configurados:

- bloqueo completo de acceso público;
- ownership `BucketOwnerEnforced`;
- cifrado SSE-S3 (`AES256`);
- bucket policy que rechaza transporte sin TLS;
- multipart uploads incompletos eliminados después de 1 día;
- objetos bajo `raw-events/` eliminados después de 30 días.

No existe una regla de expiración general para los medios bajo `tenants/`; esos objetos permanecen
hasta que una operación o política futura los elimine.

## 8. KMS

Recursos:

- `ProviderCredentialsKey`: clave simétrica `ENCRYPT_DECRYPT` administrada por el proyecto;
- `ProviderCredentialsKeyAlias`: alias `alias/tinkiva-messaging-provider-credentials-${stage}`.

La clave cifra las credenciales de Telegram y WhatsApp antes de almacenarlas como ciphertext en
`MessagingControlTable`. El encryption context incluye proveedor, conexión, stage y tabla, evitando
que un ciphertext sea reutilizado fuera de su contexto esperado.

Protecciones:

- rotación automática habilitada;
- clave de una sola región;
- ventana de borrado de 30 días;
- `DeletionPolicy: Retain` y `UpdateReplacePolicy: Retain`.

Esta clave no cifra el bucket S3 ni las tablas completas. S3 usa SSE-S3; DynamoDB, SQS y SNS usan
claves administradas por sus respectivos servicios. La clave dedicada protege específicamente los
secretos de proveedores almacenados dentro de DynamoDB.

## 9. Secrets Manager

### Secretos creados por CloudFormation

| Secreto                                        | Uso                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `/tinkiva/messaging/${stage}/auth/pepper`      | Pepper de 64 caracteres para derivar el digest de los client secrets |
| `/tinkiva/messaging/${stage}/auth/jwt-signing` | Clave simétrica de 64 caracteres para firmar JWT HS256               |

No tienen rotación automática configurada. Las Lambdas mantienen valores leídos en caché durante
cinco minutos mientras el execution environment permanece caliente.

### Secretos creados por el CLI administrativo

`pnpm admin:create-application` crea un secreto adicional por aplicación consumidora, normalmente:

```text
/tinkiva/messaging/${stage}/applications/${application-code}/client
```

Ese secreto contiene `applicationId`, `clientId` y `clientSecret`. Se crea mediante AWS SDK y no es
un recurso del stack CloudFormation. Por eso:

- su cantidad crece con el número de aplicaciones;
- tiene costo y ciclo de vida independientes;
- eliminar el stack no lo elimina;
- debe incluirse en inventarios, backups, rotación y procedimientos de baja.

Las credenciales de Meta y Telegram no crean un Secret Manager secret por integración. Se cifran con
`ProviderCredentialsKey` y se almacenan en DynamoDB, reduciendo el número de secretos cobrados por
conexión.

## 10. IAM

Cada Lambda de aplicación tiene un role dedicado. La intención es que una función solo pueda acceder
a sus tablas, colas, secretos, objetos y operaciones KMS necesarias.

| Role                           | Permisos principales                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `HealthLambdaRole`             | Escribir logs                                                                    |
| `AuthTokenLambdaRole`          | Leer ControlTable, AuthPepperSecret y JwtSigningSecret                           |
| `ApiAuthorizerLambdaRole`      | Leer ControlTable y JwtSigningSecret                                             |
| `PrivateApiLambdaRole`         | CRUD/transacciones en tablas, publicar outbound, KMS encrypt/decrypt, S3 get/put |
| `TelegramWebhookLambdaRole`    | Leer integración, KMS decrypt, publicar InboundQueue                             |
| `WhatsappWebhookLambdaRole`    | Leer integración, KMS decrypt, publicar InboundQueue, S3 get                     |
| `InboundProcessorLambdaRole`   | Consumir InboundQueue, escribir tablas/S3, KMS decrypt                           |
| `TelegramSenderLambdaRole`     | Consumir cola Telegram, leer/actualizar tablas, KMS decrypt, S3 get              |
| `WhatsappSenderLambdaRole`     | Consumir cola WhatsApp, leer/actualizar tablas, KMS decrypt, S3 get              |
| `AppEventProjectorLambdaRole`  | Leer DynamoDB Stream/S3 y publicar AppEventsQueue y StoragiaAutomationQueue      |
| `RealtimeConnectionLambdaRole` | Mantener tickets/conexiones en ControlTable                                      |
| `RealtimeDispatcherLambdaRole` | Consumir AppEventsQueue, consultar conexiones y ManageConnections                |

También existe `IamRoleCustomResourcesLambdaExecution`, utilizado únicamente por la Lambda auxiliar
de Serverless que configura logging de API Gateway.

Los CLI administrativos no tienen roles creados por este stack; utilizan las credenciales AWS del
operador que los ejecuta. Esas identidades deben gestionarse fuera de esta plantilla.

## 11. CloudWatch y SNS

### Logs

Se crean 14 log groups:

- uno por cada una de las 12 Lambdas de aplicación;
- uno para API Gateway WebSocket;
- uno para la Lambda auxiliar de Serverless Framework.

La retención general es de 14 días. El contenido de mensajes completos no debería registrarse en
producción.

### Alarmas

Hay seis alarmas, una por cada DLQ. Cada alarma revisa cada 60 segundos la métrica
`ApproximateNumberOfMessagesVisible` y entra en alarma cuando hay al menos un mensaje visible.

Las alarmas publican en el topic SNS:

```text
tinkiva-messaging-alarms-${stage}
```

El topic usa cifrado `alias/aws/sns`. Si se proporciona el parámetro `alarmEmail`, CloudFormation
crea una suscripción email condicional. La suscripción no empieza a entregar hasta que el receptor
confirma el correo enviado por AWS.

Actualmente no se declaran alarmas para:

- errores, throttles o duración de Lambda;
- edad del mensaje más antiguo en colas fuente;
- API Gateway `4xx/5xx` o latencia;
- throttling y errores de DynamoDB;
- iterator age del DynamoDB Stream;
- conexiones o errores WebSocket;
- almacenamiento y errores S3.

## 12. Recursos auxiliares generados

Además de los servicios principales, CloudFormation crea recursos de unión:

- 23 `AWS::ApiGatewayV2::Route` — 19 HTTP y 4 WebSocket;
- 6 `AWS::ApiGatewayV2::Integration`;
- 2 stages de API Gateway;
- 1 deployment WebSocket;
- 1 Lambda authorizer;
- 2 WebSocket route responses;
- 7 permisos para que API Gateway invoque Lambdas;
- 5 event source mappings para SQS y DynamoDB Streams;
- 1 custom resource que configura el role de CloudWatch de API Gateway.

Normalmente estos recursos no se administran manualmente. Deben modificarse desde `serverless.yml` y
desplegarse mediante Serverless Framework.

## 13. Integraciones externas no AWS

Aunque no son recursos AWS, determinan el tráfico y la operación del stack:

- Telegram Bot API: validación del bot, configuración de webhook, envío y descarga de medios;
- Meta Graph API / WhatsApp Cloud API: Embedded Signup, inspección de tokens, suscripción de WABA,
  envío de mensajes y descarga de medios;
- backend principal: usa `MessagingGatewayClient` con credenciales M2M;
- consumidor de automatización de StoragIA: Nest en EC2 recibe desde `StoragiaAutomationQueue.fifo`,
  administra su propia idempotencia y extiende la visibilidad cuando un procesamiento pueda superar
  cinco minutos;
- navegadores: se conectan directamente al API Gateway WebSocket con tickets temporales.

TinkivaMessaging entrega a SQS, pero no inicia conexiones hacia la EC2 ni accede a PostgreSQL. El
consumidor, su role IAM y su lógica de automatización pertenecen al repositorio StoragIA.

## 14. Principales fuentes de costo

### Costos recurrentes aun con tráfico bajo

- clave KMS administrada por el proyecto;
- dos secretos base de autenticación;
- un secreto adicional por cada aplicación consumidora;
- seis alarmas CloudWatch;
- almacenamiento acumulado en S3, CloudWatch Logs y bucket de despliegue.

### Costos dependientes del uso

- invocaciones y duración de Lambda;
- requests y conexiones/minutos de API Gateway HTTP/WebSocket;
- lecturas, escrituras, transacciones, streams y almacenamiento DynamoDB;
- requests y transferencia SQS/SNS;
- requests, almacenamiento y transferencia S3;
- operaciones KMS y Secrets Manager;
- ingestión y almacenamiento de CloudWatch Logs;
- salida de datos hacia internet y URLs firmadas de medios.

No hay costo permanente de servidores, NAT Gateway, balanceadores o bases de datos dentro de este
stack. Tampoco hay provisioned concurrency.

## 15. Puntos recomendados para el análisis

### Prioridad alta

1. **Decidir el futuro de MediaQueue.** Hoy está desplegada y monitorizada, pero no tiene productor
   ni consumidor.
2. **Ampliar observabilidad.** Las DLQ están cubiertas, pero faltan alarmas de errores Lambda,
   throttling, duración, queue age, API 5xx e iterator age.
3. **Revisar recuperación de datos.** PITR y deletion protection solo están activas en `prod`. La
   clave de credenciales tiene políticas `Retain`, pero tablas, bucket y secretos base no tienen una
   política `Retain` equivalente declarada.
4. **Inventariar secretos por aplicación.** No aparecen dentro del stack y pueden quedar huérfanos
   al retirar una aplicación.

### Rendimiento y costo

5. **Evaluar caché corta del authorizer.** El TTL actual es cero. Una caché de pocos segundos puede
   reducir invocaciones y lecturas, aceptando una demora equivalente para revocaciones.
6. **Medir batches y concurrencia.** Los consumidores usan batches, pero no declaran reserved
   concurrency ni maximum concurrency. Debe ajustarse con métricas y límites de Telegram/Meta.
7. **Revisar procesamiento secuencial.** Los handlers recorren cada batch secuencialmente. Puede
   paralelizarse entre `MessageGroupId` manteniendo orden dentro de cada conversación.
8. **Vigilar retención de medios.** Los objetos `tenants/` no expiran automáticamente y pueden
   convertirse en la principal fuente de almacenamiento.

### Seguridad

9. **Automatizar rotación.** Los secretos base y los secretos M2M no tienen rotación automática.
10. **Revisar permisos no utilizados.** Por ejemplo, el role del webhook de WhatsApp incluye
    `s3:GetObject`; debe confirmarse si sigue siendo necesario.
11. **Definir protección perimetral.** WAF, custom domain, ACM y Route 53 no forman parte de este
    stack. Si existen, deben documentarse como infraestructura externa; si no existen, evaluar su
    necesidad para producción.
12. **Agregar control presupuestal.** No hay AWS Budgets ni Cost Anomaly Detection declarados en el
    repositorio.

## 16. Fuentes de verdad

| Tema                       | Archivo                                                  |
| -------------------------- | -------------------------------------------------------- |
| Funciones, APIs y triggers | `serverless.yml`                                         |
| Tablas                     | `infrastructure/serverless/dynamodb.yml`                 |
| Colas y DLQ                | `infrastructure/serverless/queues.yml`                   |
| Bucket y policy            | `infrastructure/serverless/storage.yml`                  |
| KMS                        | `infrastructure/serverless/provider-credentials-kms.yml` |
| Secretos base              | `infrastructure/serverless/secrets.yml`                  |
| IAM                        | `infrastructure/serverless/*-iam.yml` y `iam.yml`        |
| Alarmas y SNS              | `infrastructure/serverless/monitoring.yml`               |
| Suscripción email          | `infrastructure/serverless/subscriptions.yml`            |
| Outputs                    | `infrastructure/serverless/outputs.yml`                  |
| Secretos de aplicaciones   | `src/cli/create-application.ts`                          |

Este inventario describe lo administrado o utilizado por el repositorio. Para una auditoría completa
de la cuenta AWS también deben revisarse recursos compartidos o externos al stack, como DNS,
certificados, WAF, el bucket de despliegue, IAM de operadores, budgets y cualquier secreto creado
manualmente.
