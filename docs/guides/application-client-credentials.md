# Credenciales de aplicaciones y acceso administrativo global

## Resultado esperado

Tinkiva Messaging usa una sola aplicación privilegiada, `PLATFORM_ADMIN`, para la administración
global. Su cliente tiene únicamente el scope `platform:admin` y permite entrar a `/admin`, listar
todas las integraciones y ejecutar las operaciones globales disponibles allí.

Una credencial de aplicación tiene dos piezas distintas:

- `clientId` y el digest HMAC del `clientSecret` se guardan en DynamoDB;
- el `clientSecret` en texto claro se entrega una sola vez. El gateway no puede reconstruirlo desde
  el digest.

Secrets Manager conserva solamente los dos secretos internos del gateway (`auth/pepper` y
`auth/jwt-signing`) y, por compatibilidad, la credencial administrativa global. El CLI ya no crea un
Secret de AWS por aplicación de manera predeterminada.

## Cómo obtener acceso a la consola global en `dev`

La aplicación administrativa ya provisionada usa:

```text
/tinkiva/messaging/dev/applications/platform_admin/client
```

Desde AWS Console:

1. Abra **Secrets Manager** en `us-east-1`.
2. Busque exactamente el nombre anterior.
3. Seleccione **Retrieve secret value**.
4. Copie `clientId` y `clientSecret` en los campos de inicio de sesión de `/admin`.
5. Presione **Iniciar sesión**. La página llama a `POST /v1/auth/token` y usa el JWT corto devuelto.

La página no guarda el `clientSecret`. Solo mantiene el JWT en `sessionStorage`, por lo que se
elimina al cerrar la pestaña. Un HTTP 403 normalmente significa que se usó el cliente de Storagia o
Tinkiva, cuyos scopes no incluyen `platform:admin`; no significa que deba crearse otra credencial
administrativa.

Para una automatización autorizada, el intercambio equivalente es:

```http
POST /v1/auth/token
Content-Type: application/json

{
  "clientId": "<clientId administrativo>",
  "clientSecret": "<clientSecret administrativo>"
}
```

No copie esos valores a documentación, tickets, logs ni historial del shell.

## Alta recomendada de una aplicación SaaS

Sin `--credentials-secret-name`, el CLI crea la aplicación y su digest en DynamoDB, y muestra el
`clientSecret` una sola vez:

```powershell
pnpm admin:create-application `
  --code NUEVA_APP `
  --name "Nueva aplicación" `
  --stage dev `
  --region us-east-1
```

La salida indica `credentialDelivery: ONE_TIME_STDOUT` e incluye una advertencia. Quien ejecuta el
alta debe guardar inmediatamente la credencial en el vault propio del consumidor. Si se pierde, no
se intenta recuperarla desde DynamoDB: se revoca o reemplaza el cliente.

Para el administrador global o un consumidor interno que todavía dependa de AWS Secrets Manager, la
creación del Secret es un opt-in explícito:

```powershell
pnpm admin:create-application `
  --code PLATFORM_ADMIN `
  --name "Platform administration" `
  --stage dev `
  --region us-east-1 `
  --scopes platform:admin `
  --credentials-secret-name /tinkiva/messaging/dev/applications/platform_admin/client
```

En ese modo la salida no expone el `clientSecret`; devuelve el nombre y ARN del Secret creado. Este
comando es solo para un stage nuevo: en `dev` la aplicación y el Secret ya existen, y el CLI rechaza
correctamente un código duplicado.

## Por qué no usar un único JSON con todos los clientes

Un solo Secret JSON reduciría el contador de Secrets Manager, pero convertiría una optimización de
costo en una credencial maestra compartida:

- cualquier role con `GetSecretValue` podría leer los clientes de todas las aplicaciones;
- una rotación o error afectaría a todos los consumidores y ampliaría el radio de impacto;
- dos altas o rotaciones concurrentes podrían sobrescribir cambios dentro del mismo documento;
- no sería posible revocar acceso a una sola aplicación mediante IAM.

Tampoco hace falta que el gateway conserve esos valores: para validar `POST /v1/auth/token` compara
el HMAC recibido con `secretDigest` en DynamoDB usando el pepper interno. Por eso el diseño objetivo
es **digest por cliente en DynamoDB + entrega única al vault del consumidor**, no un Secret por
cliente ni un JSON global.

Los secretos internos `auth/pepper` y `auth/jwt-signing` tampoco se combinan. Tienen permisos,
funciones y ciclos de rotación distintos.

## Compatibilidad y migración de `dev`

No se deben borrar todavía estos Secrets existentes:

```text
/tinkiva/messaging/dev/applications/storagia/client
/tinkiva/messaging/dev/applications/tinkiva_dev/client
```

La auditoría de CloudTrail del 12 de agosto de 2026 confirmó consumidores activos:

- Storagia lo recupera con el role `storagia-dev-backend-ec2`;
- Tinkiva Dev lo recupera con el IAM user `s3-full-access`.

La auditoría también detectó que la policy inline `StoragiaBackendRuntime` permitía
`secretsmanager:GetSecretValue` sobre `/applications/*`. El 12 de agosto de 2026 se corrigió en AWS:
ahora apunta al ARN exacto de `/tinkiva/messaging/dev/applications/storagia/client`, y la simulación
IAM confirmó `implicitDeny` para `platform_admin/client`.

Secuencia segura, sin corte:

1. Copiar en memoria la credencial existente al vault/configuración propia de cada consumidor; no
   cambiar todavía el cliente de DynamoDB.
2. Cambiar el consumidor para leer desde su vault propio y validar varias renovaciones de JWT.
3. Mantener el permiso del role de Storagia limitado al ARN exacto mientras dure la transición; no
   restaurar el wildcard `/applications/*`.
4. Confirmar en CloudTrail que ya no hay lecturas del Secret legado durante una ventana operativa
   acordada.
5. Recién entonces programar su eliminación con período de recuperación y documentar rollback.

La credencial `PLATFORM_ADMIN` permanece como el único Secret de cliente administrado globalmente.
No se migran ni eliminan los dos consumidores existentes como parte del cambio de comportamiento del
CLI.
