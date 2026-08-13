# Enriquecimiento de medios entrantes con OpenAI

El gateway puede generar `metadata.alternativeText` para imágenes y audios recibidos desde WhatsApp
o Telegram. La función se activa por integración y está desactivada de forma predeterminada. No
procesa medios enviados por el gateway ni completa mensajes históricos.

## Credencial de OpenAI

Cada integración mantiene su propia credencial. No existe una clave global de OpenAI ni un secreto
de Secrets Manager para este flujo. Use una clave de proyecto o service account dedicada, con los
límites de gasto y acceso mínimos; no use una clave personal compartida. La
[documentación oficial de autenticación de OpenAI](https://developers.openai.com/api/reference/overview#authentication)
exige tratar la clave como un secreto del servidor.

La opción recomendada es abrir `GET <gateway-base-url>/admin`, iniciar sesión con el `clientId` y el
`clientSecret` de la aplicación administrativa global y configurar la credencial en la fila de la
integración. La consola obtiene automáticamente un JWT corto con `POST /v1/auth/token`. El navegador
envía la clave de OpenAI una sola vez al API; la lista posterior solo muestra este estado no
sensible:

```json
{
  "configured": true,
  "credentialVersion": 1,
  "updatedAt": "<ISO-8601>"
}
```

El backend cifra el siguiente objeto con `ProviderCredentialsKey` y guarda únicamente el ciphertext
en `MessagingControlTable`, aislado por integración:

```json
{
  "apiKey": "<OpenAI project API key>",
  "organization": "<optional organization ID>",
  "project": "<optional project ID>"
}
```

```text
PK = INTEGRATION#<integrationId>
SK = OPENAI_CREDENTIAL
```

El registro contiene `credentialCiphertext`, `credentialKeyArn`, `credentialVersion`, ownership y
timestamps; nunca contiene `apiKey`, `organization` o `project` en texto plano. El cifrado usa como
contexto KMS `stage`, `tableName`, `resourceType=OPENAI_CREDENTIAL`, `applicationId`, `tenantId` e
`integrationId`. La clave tampoco se devuelve en listados, respuestas, logs ni errores.

### API administrativa

Todas estas rutas requieren `Authorization: Bearer <token>` con el scope exacto `platform:admin`.
Para crear la primera versión, omita `expectedCredentialVersion`:

```http
PUT /v1/platform/integrations/{integrationId}/openai-credential
Authorization: Bearer <platform-admin-token>
Content-Type: application/json

{
  "apiKey": "<OpenAI project API key>",
  "applicationId": "app_...",
  "organization": "org_...",
  "project": "proj_...",
  "tenantId": "tenant_..."
}
```

`organization` y `project` son opcionales. Omitir `expectedCredentialVersion` es una operación
**create-only**: falla si la integración ya tiene una credencial. Para rotar, envíe el mismo request
con `expectedCredentialVersion` igual a la versión que muestra el panel. Un cambio concurrente
devuelve `409`; recargue el estado antes de reintentar. La respuesta contiene únicamente
`configured`, `credentialVersion` y `updatedAt`.

Para retirar la credencial se exige la versión actual:

```http
DELETE /v1/platform/integrations/{integrationId}/openai-credential
Authorization: Bearer <platform-admin-token>
Content-Type: application/json

{
  "applicationId": "app_...",
  "expectedCredentialVersion": 2,
  "tenantId": "tenant_..."
}
```

La respuesta indica `configured: false`; no devuelve material secreto. La eliminación apaga ambos
flags de enriquecimiento en la misma transacción. Cualquier trabajo obsoleto que permanezca en
`MediaQueue` queda rechazado antes de leer S3 o llamar a OpenAI.

## Modelos y despliegue

Los valores predeterminados son:

| Uso                     | Parámetro de Serverless | Variable de Lambda   | Valor predeterminado     |
| ----------------------- | ----------------------- | -------------------- | ------------------------ |
| Descripción de imágenes | `openAiImageModel`      | `OPENAI_IMAGE_MODEL` | `gpt-5.6-luna`           |
| Transcripción de audio  | `openAiAudioModel`      | `OPENAI_AUDIO_MODEL` | `gpt-4o-mini-transcribe` |

Para conservar los modelos predeterminados no hace falta pasar parámetros. Para fijarlos
explícitamente:

```powershell
$env:STORAGIA_AUTOMATION_APPLICATION_ID = "app_<real-storagia-application-id>"
pnpm exec serverless deploy `
  --stage $Stage `
  --region $Region `
  --param="openAiImageModel=gpt-5.6-luna" `
  --param="openAiAudioModel=gpt-4o-mini-transcribe"
```

Cambiar un modelo exige desplegar de nuevo; rotar la credencial no. Confirme antes que el proyecto
de OpenAI tenga acceso a ambos modelos. Las imágenes se analizan con Responses y `store: false`.
Consulte las guías oficiales de
[visión](https://developers.openai.com/api/docs/guides/images-vision) y
[speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text).

## Formatos y límites

| Medio entrante          | Tratamiento antes de OpenAI                                      |
| ----------------------- | ---------------------------------------------------------------- |
| JPEG, PNG, WebP         | Se envía a Responses como imagen; el gateway admite hasta 20 MB. |
| MP3/MPEG, MP4/M4A, WebM | Se envía directamente a `/v1/audio/transcriptions`.              |
| AAC, AMR, OGG/Opus      | FFmpeg lo convierte temporalmente a MP3 dentro de la Lambda.     |

Telegram admite hasta 20 MB de audio entrante y WhatsApp hasta 16 MB en este gateway. Después de la
normalización, el archivo debe ocupar como máximo 25 MB, que es el límite de la API de transcripción
de OpenAI. Un archivo vacío, demasiado grande o que FFmpeg no pueda decodificar se marca como
enriquecimiento fallido y no produce `alternativeText`.

El binario ARM64 de FFmpeg se empaqueta con la Lambda. Para ejecutar el normalizador fuera de Linux
ARM64, instale `ffmpeg` en `PATH` o defina `FFMPEG_PATH` con la ruta del ejecutable.

## Activación por integración

Las integraciones nuevas y los registros antiguos sin configuración usan ambos flags en `false`:

```json
{
  "inboundMedia": {
    "audioAlternativeText": false,
    "imageAlternativeText": false
  }
}
```

Los flags solo tienen efecto para una integración `ACTIVE`. Un cambio se aplica a los nuevos medios
entrantes; no reprocesa mensajes anteriores ni cancela trabajos que ya estaban en cola.

## Consola administrativa

Abra `GET <gateway-base-url>/admin`. La ruta entrega únicamente el HTML y puede cargarse sin JWT; la
lista y todas las mutaciones llaman APIs protegidas. Ingrese el `clientId` y el `clientSecret` de la
aplicación administrativa global: la página los intercambia mediante `POST /v1/auth/token`, limpia
el campo secreto tanto en éxito como en error y conserva únicamente el access token corto en
`sessionStorage` hasta cerrar la pestaña o usar **Cerrar sesión**. No guarda el `clientId` ni el
`clientSecret` en almacenamiento del navegador.

En `dev`, la única credencial administrativa global se obtiene de AWS Secrets Manager en:

```text
/tinkiva/messaging/dev/applications/platform_admin/client
```

Abra el secreto con una identidad AWS autorizada y use los campos `clientId` y `clientSecret`; no
copie el ARN ni el nombre del secreto en los campos de acceso. La consola muestra también la ruta
correspondiente al stage desplegado y un enlace a Secrets Manager. Una respuesta `401` significa que
las credenciales no son válidas. Una respuesta `403` significa que el cliente autenticado no incluye
el scope exacto `platform:admin`; en ambos casos la consola descarta cualquier JWT anterior.

Use una aplicación administrativa dedicada y no otorgue `platform:admin` a clientes normales de
tenant. Por ejemplo:

```powershell
pnpm admin:create-application `
  --code PLATFORM_ADMIN `
  --name "Platform administration" `
  --scopes platform:admin `
  --stage $Stage `
  --region $Region
```

La consola hace el intercambio de `clientId` y `clientSecret` por el JWT; no es necesario obtener ni
pegar el token manualmente. Permite listar globalmente integraciones y cantidades de chats,
crear/rotar/eliminar su credencial OpenAI, cambiar ambos flags y ejecutar las eliminaciones
disponibles. Las APIs subyacentes rechazan con `403` cualquier JWT que no contenga `platform:admin`.

`Borrar chats` elimina el historial y sus objetos de medios existentes, pero mantiene activa la
integración; un mensaje recibido después puede crear un chat nuevo. `Borrar integración + chats`
deshabilita primero el ingreso local, elimina chats, medios, referencias y la credencial cifrada, y
finalmente elimina la integración local. Esta última operación no modifica suscripciones remotas en
Telegram o Meta: si la cuenta se retira definitivamente, quite también el webhook o la suscripción
desde el proveedor, teniendo en cuenta si una WABA es compartida por otras integraciones.
