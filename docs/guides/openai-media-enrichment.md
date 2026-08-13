# Enriquecimiento de medios entrantes con OpenAI

El gateway puede generar `metadata.alternativeText` para imágenes y audios recibidos desde WhatsApp
o Telegram. La función se activa por integración y está desactivada de forma predeterminada. No
procesa medios enviados por el gateway ni completa mensajes históricos.

## Credencial de OpenAI

Cada tenant SaaS mantiene una sola credencial OpenAI compartida por StoragIA Backend y todas sus
integraciones de Tinkiva Messaging. Se administra desde el backend autenticado del SaaS; el
`tenantId` se deriva de la sesión y nunca se acepta desde el body. La consola global de Messaging
solo muestra su estado y no puede crear, rotar ni eliminar la clave.

La fuente única es `TinkivaTenantIntegrations`:

```text
PK = TENANT#<tenantId>
SK = PROVIDER#OPENAI
```

El registro guarda `credentialEncrypted` en base64, `credentialLast4`, `enabled`,
`credentialStatus`, `createdAt` y `updatedAt`. No guarda texto plano. KMS cifra y descifra usando
exactamente este contexto:

```json
{
  "tenantId": "<tenantId>",
  "provider": "OPENAI"
}
```

La Lambda recibe `TINKIVA_INTEGRATIONS_TABLE` y `TINKIVA_KMS_KEY_ID`, consulta por tenant y mantiene
el plaintext solo en memoria con cache TTL de cinco minutos. Primero resuelve el `externalAccountId`
del vínculo activo entre el tenant interno de Messaging y la aplicación; ese identificador es el
`accountId` usado por StoragIA como tenant criptográfico. Su rol permite `dynamodb:Query` solo en la
tabla de control, `dynamodb:GetItem` en la tabla de integraciones y `kms:Decrypt`. La credencial
nunca viaja por SQS, respuestas o logs. Una credencial ausente, deshabilitada o marcada `INVALID`
produce un fallo permanente y no se reintenta indefinidamente.

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

La consola hace el intercambio de `clientId` y el `clientSecret` por el JWT; no es necesario obtener
ni pegar el token manualmente. Permite listar integraciones y cantidades de chats, ver si el tenant
tiene OpenAI configurado, cambiar ambos flags y ejecutar las eliminaciones disponibles. La
credencial se gestiona exclusivamente en el SaaS autenticado. Las APIs subyacentes rechazan con
`403` cualquier JWT que no contenga `platform:admin`.

`Borrar chats` elimina el historial y sus objetos de medios existentes, pero mantiene activa la
integración; un mensaje recibido después puede crear un chat nuevo. `Borrar integración + chats`
deshabilita primero el ingreso local y elimina chats, medios y referencias de la integración, y
finalmente elimina la integración local. Esta última operación no modifica suscripciones remotas en
Telegram o Meta: si la cuenta se retira definitivamente, quite también el webhook o la suscripción
desde el proveedor, teniendo en cuenta si una WABA es compartida por otras integraciones.
