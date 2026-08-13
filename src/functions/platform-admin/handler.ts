import { randomBytes } from "node:crypto";

import { Logger } from "@aws-lambda-powertools/logger";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { z } from "zod";

import { PlatformAdmin } from "../../application/platform-admin/platform-admin.js";
import {
  deletePlatformIntegrationOpenAiCredentialRequestSchema,
  openAiCredentialStatusSchema,
  platformIntegrationDeletionRequestSchema,
  platformIntegrationListQuerySchema,
  putPlatformIntegrationOpenAiCredentialRequestSchema,
  updatePlatformIntegrationInboundMediaRequestSchema,
} from "../../contracts/api/platform-admin.contract.js";
import { integrationIdSchema } from "../../contracts/shared/identifiers.js";
import { dynamoDocumentClient, kmsClient, s3Client } from "../../infrastructure/aws/clients.js";
import { KmsDynamoOpenAICredentialVault } from "../../infrastructure/dynamodb/kms-dynamo-openai-credential-vault.js";
import { DynamoPlatformAdminStore } from "../../infrastructure/dynamodb/dynamo-platform-admin-store.js";
import { S3MediaStore } from "../../infrastructure/s3/s3-media-store.js";
import { loadPlatformAdminRuntimeConfig } from "../../shared/config/platform-admin-runtime-config.js";
import { ApplicationError } from "../../shared/errors/application-error.js";
import { resolveCorrelationId } from "../../shared/http/correlation-id.js";
import { errorResponse } from "../../shared/http/error-response.js";
import { jsonResponse } from "../../shared/http/json-response.js";
import { readJsonBody } from "../../shared/http/request-body.js";

type PlatformAdminEvent = APIGatewayProxyEventV2 & {
  requestContext: APIGatewayProxyEventV2["requestContext"] & {
    authorizer?: {
      lambda?: unknown;
    };
  };
};

const authorizerContextSchema = z.strictObject({
  applicationId: z.string().min(1),
  clientId: z.string().min(1),
  scope: z.string(),
});

const logger = new Logger({ serviceName: "platform-admin" });

export interface PlatformAdminHandlerDependencies {
  platformAdmin: Pick<
    PlatformAdmin,
    | "deleteIntegrationData"
    | "deleteOpenAiCredential"
    | "listIntegrations"
    | "putOpenAiCredential"
    | "updateInboundMedia"
  >;
  stage: string;
}

export const createPlatformAdminHandler =
  ({ platformAdmin, stage }: PlatformAdminHandlerDependencies) =>
  async (event: PlatformAdminEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    const correlationId = resolveCorrelationId(event.headers);

    if (event.routeKey === "GET /admin") return adminHtmlResponse(stage);

    try {
      const identity = authorizerContextSchema.parse(event.requestContext.authorizer?.lambda);
      requirePlatformAdmin(identity.scope);

      if (event.routeKey === "GET /v1/platform/integrations") {
        const query = platformIntegrationListQuerySchema.parse(event.queryStringParameters ?? {});
        const result = await platformAdmin.listIntegrations(
          query.cursor === undefined ? {} : { cursor: query.cursor },
        );
        return jsonResponse(200, result, correlationId);
      }

      if (event.routeKey === "PATCH /v1/platform/integrations/{integrationId}/inbound-media") {
        const integrationId = integrationIdSchema.parse(event.pathParameters?.integrationId);
        const request = updatePlatformIntegrationInboundMediaRequestSchema.parse(
          readJsonBody(event),
        );
        const result = await platformAdmin.updateInboundMedia(integrationId, request);
        logger.info("Platform integration media settings updated.", {
          clientId: identity.clientId,
          integrationId,
        });
        return jsonResponse(
          200,
          { integrationId, inboundMedia: result.inboundMedia, updatedAt: result.updatedAt },
          correlationId,
        );
      }

      if (event.routeKey === "PUT /v1/platform/integrations/{integrationId}/openai-credential") {
        const integrationId = integrationIdSchema.parse(event.pathParameters?.integrationId);
        const request = putPlatformIntegrationOpenAiCredentialRequestSchema.parse(
          readJsonBody(event),
        );
        const result = await platformAdmin.putOpenAiCredential(integrationId, request);
        logger.info("Platform integration OpenAI credential configured.", {
          clientId: identity.clientId,
          credentialVersion: result.credentialVersion,
          integrationId,
        });
        return jsonResponse(200, openAiCredentialStatusSchema.parse(result), correlationId);
      }

      if (event.routeKey === "DELETE /v1/platform/integrations/{integrationId}/openai-credential") {
        const integrationId = integrationIdSchema.parse(event.pathParameters?.integrationId);
        const request = deletePlatformIntegrationOpenAiCredentialRequestSchema.parse(
          readJsonBody(event),
        );
        const result = await platformAdmin.deleteOpenAiCredential(integrationId, request);
        logger.info("Platform integration OpenAI credential deleted.", {
          clientId: identity.clientId,
          integrationId,
        });
        return jsonResponse(200, openAiCredentialStatusSchema.parse(result), correlationId);
      }

      if (event.routeKey === "POST /v1/platform/integrations/{integrationId}/deletions") {
        const integrationId = integrationIdSchema.parse(event.pathParameters?.integrationId);
        const request = platformIntegrationDeletionRequestSchema.parse(readJsonBody(event));
        const result = await platformAdmin.deleteIntegrationData(integrationId, request);
        logger.info("Platform integration deletion batch processed.", {
          clientId: identity.clientId,
          deletedChats: result.deletedChats,
          integrationId,
          mode: result.mode,
          status: result.status,
        });
        return jsonResponse(result.status === "IN_PROGRESS" ? 202 : 200, result, correlationId);
      }

      throw new ApplicationError(
        "ADMIN_ROUTE_NOT_FOUND",
        "The requested administration route does not exist.",
        404,
      );
    } catch (error) {
      if (error instanceof ApplicationError) {
        logger.warn("Platform administration request rejected.", {
          code: error.code,
          correlationId,
          routeKey: event.routeKey,
          statusCode: error.statusCode,
        });
      } else if (!(error instanceof z.ZodError)) {
        logger.error("Unhandled platform administration error.", {
          correlationId,
          error,
          routeKey: event.routeKey,
        });
      }
      return errorResponse(error, correlationId);
    }
  };

const requirePlatformAdmin = (scope: string): void => {
  if (!scope.split(" ").includes("platform:admin")) {
    throw new ApplicationError(
      "AUTH_SCOPE_MISSING",
      "The access token does not grant platform administration access.",
      403,
    );
  }
};

const adminHtmlResponse = (stage: string): APIGatewayProxyStructuredResultV2 => {
  const nonce = randomBytes(18).toString("base64");
  return {
    body: renderAdminHtml(nonce, stage),
    headers: {
      "cache-control": "no-store",
      "content-security-policy":
        `default-src 'none'; base-uri 'none'; connect-src 'self'; form-action 'none'; ` +
        `frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; ` +
        `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
      "content-type": "text/html; charset=utf-8",
      "permissions-policy": "camera=(), geolocation=(), microphone=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
    isBase64Encoded: false,
    statusCode: 200,
  };
};

const renderAdminHtml = (nonce: string, stage: string): string => `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tinkiva Messaging · Integraciones</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #07111f; color: #e6edf7; }
    main { width: min(1500px, calc(100% - 32px)); margin: 32px auto 72px; }
    h1 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.5rem); }
    h2 { font-size: 1.1rem; margin: 0 0 12px; }
    p { color: #9fb0c7; }
    .top { display: flex; gap: 20px; align-items: end; justify-content: space-between; margin-bottom: 24px; }
    .card { background: #0d1b2d; border: 1px solid #24364d; border-radius: 14px; padding: 18px; box-shadow: 0 18px 50px #0005; }
    form { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    label { display: grid; gap: 7px; color: #b9c7d9; font-size: .9rem; }
    #client-id, #client-secret { min-width: min(360px, 76vw); }
    input, button { border-radius: 8px; border: 1px solid #39516f; font: inherit; }
    input { background: #081423; color: #fff; padding: 10px 12px; }
    button { background: #183a61; color: #fff; padding: 9px 12px; cursor: pointer; }
    button:hover { background: #215184; }
    button:disabled { cursor: wait; opacity: .55; }
    button.danger { background: #6f2130; border-color: #a44354; }
    button.danger:hover { background: #913047; }
    button.secondary { background: #15263a; }
    .status { min-height: 26px; margin: 14px 0; color: #a9bad0; }
    .status.error { color: #ff9ca8; }
    .help { margin: 14px 0 0; line-height: 1.55; }
    a { color: #8fc2ff; }
    .toolbar { display: flex; gap: 10px; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .table-wrap { overflow: auto; border: 1px solid #24364d; border-radius: 12px; }
    table { border-collapse: collapse; width: 100%; min-width: 1180px; background: #0b1828; }
    th, td { text-align: left; padding: 11px 10px; border-bottom: 1px solid #203249; vertical-align: middle; }
    th { position: sticky; top: 0; background: #12243a; color: #b9c9dc; font-size: .78rem; letter-spacing: .04em; text-transform: uppercase; }
    td { font-size: .88rem; }
    code { color: #b9d6ff; font-size: .78rem; }
    .actions { display: flex; gap: 7px; flex-wrap: wrap; min-width: 280px; }
    .credential { display: grid; gap: 7px; min-width: 300px; }
    .credential input { min-width: 0; width: 100%; padding: 7px 9px; }
    .credential-actions { display: flex; gap: 7px; flex-wrap: wrap; }
    .toggle { display: flex; gap: 8px; align-items: center; white-space: nowrap; }
    .badge { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #193a5c; }
    .empty { padding: 28px; text-align: center; color: #92a5bd; }
    [hidden] { display: none !important; }
    @media (max-width: 720px) { .top { display: block; } main { width: min(100% - 20px, 1500px); margin-top: 18px; } }
  </style>
</head>
<body>
<main>
  <div class="top">
    <div><h1>Integraciones de mensajería</h1><p>Administración global de chats y enriquecimiento de medios entrantes.</p></div>
  </div>
  <section class="card" aria-labelledby="access-title">
    <h2 id="access-title">Acceso administrativo</h2>
    <form id="login-form" autocomplete="off" novalidate>
      <label>Client ID
        <input id="client-id" type="text" autocomplete="off" spellcheck="false" placeholder="msgc_…" required>
      </label>
      <label>Client secret
        <input id="client-secret" type="password" autocomplete="new-password" spellcheck="false" placeholder="msgs_…" required>
      </label>
      <button id="login" type="submit">Iniciar sesión</button>
      <button id="logout" class="secondary" type="button">Cerrar sesión</button>
    </form>
    <p class="help">
      Use la credencial administrativa global con scope <code>platform:admin</code>. En <code>${stage}</code>
      está en <code>/tinkiva/messaging/${stage}/applications/platform_admin/client</code> de
      <a href="https://console.aws.amazon.com/secretsmanager/home#/listSecrets" target="_blank" rel="noopener noreferrer">AWS Secrets Manager</a>.
      Consulte el valor con una identidad AWS autorizada e ingrese sus campos <code>clientId</code> y
      <code>clientSecret</code>. La consola intercambia esas credenciales por un JWT corto y guarda
      únicamente el access token en <code>sessionStorage</code>; nunca conserva el client secret.
      Un HTTP 403 indica que la credencial pertenece a un cliente sin el scope <code>platform:admin</code>.
    </p>
  </section>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <section class="card" aria-labelledby="integrations-title">
    <div class="toolbar"><h2 id="integrations-title">Integraciones</h2><button id="reload" type="button">Recargar</button></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Integración</th><th>Aplicación / tenant</th><th>Proveedor</th><th>Estado</th><th>Chats</th><th>Credencial OpenAI</th><th>Audio alt.</th><th>Imagen alt.</th><th>Acciones</th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
      <p id="empty" class="empty">Inicia sesión con la credencial administrativa global para cargar datos.</p>
    </div>
  </section>
</main>
<script nonce="${nonce}">
(() => {
  "use strict";
  const TOKEN_KEY = "tinkivaMessagingPlatformAdminToken";
  const loginForm = document.getElementById("login-form");
  const clientIdInput = document.getElementById("client-id");
  const clientSecretInput = document.getElementById("client-secret");
  const loginButton = document.getElementById("login");
  const logout = document.getElementById("logout");
  const reload = document.getElementById("reload");
  const rows = document.getElementById("rows");
  const empty = document.getElementById("empty");
  const status = document.getElementById("status");
  let integrations = [];

  const setStatus = (message, error) => {
    status.textContent = message;
    status.classList.toggle("error", Boolean(error));
  };
  const element = (name, text, className) => {
    const node = document.createElement(name);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const request = async (path, options) => {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error("Inicia sesión con la credencial administrativa global.");
    const response = await fetch(path, {
      ...options,
      headers: { "authorization": "Bearer " + token, "content-type": "application/json", ...(options && options.headers) }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      throw new Error("La sesión expiró o el access token ya no es válido. Inicia sesión nuevamente.");
    }
    if (response.status === 403) {
      sessionStorage.removeItem(TOKEN_KEY);
      throw new Error("El cliente autenticado no incluye el scope platform:admin. Usa la credencial administrativa global.");
    }
    if (!response.ok) throw new Error(payload.error && payload.error.message ? payload.error.message : "La operación falló (HTTP " + response.status + ").");
    return payload;
  };

  const issueAccessToken = async (clientId, clientSecret) => {
    const response = await fetch("/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error("Client ID o client secret inválidos. Consulta la credencial administrativa global en AWS Secrets Manager.");
    }
    if (response.status === 403) {
      throw new Error("Estas credenciales no incluyen el scope platform:admin. Usa la credencial administrativa global.");
    }
    if (!response.ok) {
      throw new Error(payload.error && payload.error.message ? payload.error.message : "No se pudo iniciar sesión (HTTP " + response.status + ").");
    }
    if (!payload || typeof payload.accessToken !== "string" || !payload.accessToken) {
      throw new Error("El servicio de autenticación devolvió una respuesta inválida.");
    }
    return payload.accessToken;
  };

  const toggleCell = (value, label) => {
    const cell = element("td");
    const wrapper = element("label", undefined, "toggle");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.setAttribute("aria-label", label);
    wrapper.append(input, document.createTextNode(value ? "Activa" : "Inactiva"));
    input.addEventListener("change", () => { wrapper.lastChild.textContent = input.checked ? "Activa" : "Inactiva"; });
    cell.append(wrapper);
    return { cell, input };
  };

  const saveConfiguration = async (item, audio, image, button) => {
    button.disabled = true;
    setStatus("Guardando configuración de " + item.integrationId + "…");
    try {
      await request("/v1/platform/integrations/" + encodeURIComponent(item.integrationId) + "/inbound-media", {
        method: "PATCH",
        body: JSON.stringify({
          applicationId: item.applicationId,
          tenantId: item.tenantId,
          inboundMedia: { audioAlternativeText: audio.checked, imageAlternativeText: image.checked }
        })
      });
      item.inboundMedia.audioAlternativeText = audio.checked;
      item.inboundMedia.imageAlternativeText = image.checked;
      setStatus("Configuración actualizada.");
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  };

  const credentialCell = (item) => {
    const cell = element("td", undefined, "credential");
    const configured = Boolean(item.openAiCredential && item.openAiCredential.configured);
    const credentialStatus = element(
      "span",
      configured ? "Configurada · v" + item.openAiCredential.credentialVersion : "No configurada",
      configured ? "badge" : undefined
    );
    const apiKey = document.createElement("input");
    apiKey.type = "password";
    apiKey.autocomplete = "new-password";
    apiKey.spellcheck = false;
    apiKey.placeholder = configured ? "Nueva API key para rotar" : "API key de OpenAI";
    apiKey.setAttribute("aria-label", "API key de OpenAI para " + item.integrationId);
    const organization = document.createElement("input");
    organization.autocomplete = "off";
    organization.placeholder = "Organization (opcional)";
    organization.setAttribute("aria-label", "Organization de OpenAI para " + item.integrationId);
    const project = document.createElement("input");
    project.autocomplete = "off";
    project.placeholder = "Project (opcional)";
    project.setAttribute("aria-label", "Project de OpenAI para " + item.integrationId);
    const actions = element("div", undefined, "credential-actions");
    const save = element("button", configured ? "Rotar clave" : "Guardar clave");
    const remove = element("button", "Eliminar clave", "danger");
    save.type = remove.type = "button";
    remove.disabled = !configured;
    save.addEventListener("click", async () => {
      if (!apiKey.value) { setStatus("Escribe una API key de OpenAI.", true); return; }
      save.disabled = true;
      setStatus((configured ? "Rotando" : "Guardando") + " credencial de " + item.integrationId + "…");
      try {
        const body = {
          apiKey: apiKey.value,
          applicationId: item.applicationId,
          tenantId: item.tenantId
        };
        const organizationValue = organization.value.trim();
        const projectValue = project.value.trim();
        if (organizationValue) body.organization = organizationValue;
        if (projectValue) body.project = projectValue;
        if (configured) body.expectedCredentialVersion = item.openAiCredential.credentialVersion;
        const result = await request("/v1/platform/integrations/" + encodeURIComponent(item.integrationId) + "/openai-credential", {
          method: "PUT",
          body: JSON.stringify(body)
        });
        apiKey.value = "";
        organization.value = "";
        project.value = "";
        item.openAiCredential = result;
        setStatus("Credencial OpenAI configurada sin exponer su valor.");
        render();
      } catch (error) { setStatus(error.message, true); }
      finally {
        apiKey.value = "";
        save.disabled = false;
      }
    });
    remove.addEventListener("click", async () => {
      if (!configured || !window.confirm("¿Eliminar la credencial OpenAI y desactivar ambos textos alternativos?")) return;
      remove.disabled = true;
      setStatus("Eliminando credencial de " + item.integrationId + "…");
      try {
        const result = await request("/v1/platform/integrations/" + encodeURIComponent(item.integrationId) + "/openai-credential", {
          method: "DELETE",
          body: JSON.stringify({
            applicationId: item.applicationId,
            expectedCredentialVersion: item.openAiCredential.credentialVersion,
            tenantId: item.tenantId
          })
        });
        item.openAiCredential = result;
        item.inboundMedia = { audioAlternativeText: false, imageAlternativeText: false };
        setStatus("Credencial eliminada y enriquecimiento desactivado.");
        render();
      } catch (error) { setStatus(error.message, true); }
      finally { remove.disabled = false; }
    });
    actions.append(save, remove);
    cell.append(credentialStatus, apiKey, organization, project, actions);
    return cell;
  };

  const runDeletion = async (item, mode, button) => {
    const description = mode === "CHATS_ONLY" ? "todos los chats" : "la integración y todos sus chats";
    const confirmation = window.prompt("Esta acción es irreversible. Para borrar " + description + ", escribe exactamente: " + item.integrationId);
    if (confirmation !== item.integrationId) { setStatus("Confirmación cancelada o incorrecta.", true); return; }
    button.disabled = true;
    let deleted = 0;
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        setStatus("Eliminando " + description + "… chats procesados: " + deleted);
        const result = await request("/v1/platform/integrations/" + encodeURIComponent(item.integrationId) + "/deletions", {
          method: "POST",
          body: JSON.stringify({ applicationId: item.applicationId, tenantId: item.tenantId, mode, confirmation })
        });
        deleted += result.deletedChats || 0;
        if (result.status === "COMPLETED") {
          setStatus("Operación completada. Chats procesados: " + deleted + ".");
          await loadAll();
          return;
        }
      }
      throw new Error("La operación requiere más bloques de los permitidos; vuelve a intentarla.");
    } catch (error) { setStatus(error.message, true); }
    finally { button.disabled = false; }
  };

  const render = () => {
    rows.replaceChildren();
    empty.hidden = integrations.length > 0;
    if (integrations.length === 0) empty.textContent = "No se encontraron integraciones.";
    integrations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const item of integrations) {
      const row = element("tr");
      const integration = element("td");
      integration.append(element("strong", item.displayName), element("br"), element("code", item.integrationId));
      const ownership = element("td");
      ownership.append(element("code", item.applicationId), element("br"), element("code", item.tenantId));
      const provider = element("td"); provider.append(element("span", item.provider, "badge"), element("br"), element("code", item.providerAccountId));
      const currentStatus = element("td", item.status);
      const chatCount = element("td", String(item.chatCount));
      const credential = credentialCell(item);
      const audio = toggleCell(item.inboundMedia.audioAlternativeText, "Texto alternativo para audio");
      const image = toggleCell(item.inboundMedia.imageAlternativeText, "Texto alternativo para imagen");
      if (!item.openAiCredential || !item.openAiCredential.configured) {
        audio.input.disabled = true;
        image.input.disabled = true;
        audio.input.title = image.input.title = "Configura primero una credencial OpenAI.";
      }
      const actionCell = element("td", undefined, "actions");
      const save = element("button", "Guardar");
      const deleteChats = element("button", "Borrar chats", "danger");
      const deleteAll = element("button", "Borrar integración + chats", "danger");
      save.type = deleteChats.type = deleteAll.type = "button";
      save.addEventListener("click", () => saveConfiguration(item, audio.input, image.input, save));
      deleteChats.addEventListener("click", () => runDeletion(item, "CHATS_ONLY", deleteChats));
      deleteAll.addEventListener("click", () => runDeletion(item, "INTEGRATION_AND_CHATS", deleteAll));
      actionCell.append(save, deleteChats, deleteAll);
      row.append(integration, ownership, provider, currentStatus, chatCount, credential, audio.cell, image.cell, actionCell);
      rows.append(row);
    }
  };

  const loadAll = async () => {
    if (!sessionStorage.getItem(TOKEN_KEY)) { integrations = []; render(); setStatus("Inicia sesión con la credencial administrativa global."); return; }
    reload.disabled = true;
    integrations = [];
    render();
    let cursor;
    try {
      for (let page = 0; page < 1000; page += 1) {
        setStatus("Cargando integraciones… página " + (page + 1));
        const suffix = cursor ? "?cursor=" + encodeURIComponent(cursor) : "";
        const result = await request("/v1/platform/integrations" + suffix, { method: "GET" });
        integrations.push(...result.items);
        render();
        cursor = result.nextCursor;
        if (!cursor) { setStatus("Integraciones cargadas: " + integrations.length + "."); return; }
      }
      throw new Error("Se alcanzó el límite de páginas administrativas.");
    } catch (error) { setStatus(error.message, true); }
    finally { reload.disabled = false; }
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const clientId = clientIdInput.value.trim();
    const clientSecret = clientSecretInput.value;
    if (!clientId || !clientSecret) {
      clientSecretInput.value = "";
      setStatus("Ingresa el Client ID y el client secret administrativos.", true);
      return;
    }
    loginButton.disabled = true;
    sessionStorage.removeItem(TOKEN_KEY);
    integrations = [];
    render();
    setStatus("Iniciando sesión administrativa…");
    try {
      const accessToken = await issueAccessToken(clientId, clientSecret);
      sessionStorage.setItem(TOKEN_KEY, accessToken);
      clientIdInput.value = "";
      setStatus("Sesión iniciada. Cargando integraciones…");
      await loadAll();
    } catch (error) {
      sessionStorage.removeItem(TOKEN_KEY);
      setStatus(error.message, true);
    } finally {
      clientSecretInput.value = "";
      loginButton.disabled = false;
    }
  });
  logout.addEventListener("click", () => {
    sessionStorage.removeItem(TOKEN_KEY);
    clientIdInput.value = "";
    clientSecretInput.value = "";
    integrations = [];
    render();
    setStatus("Sesión administrativa cerrada.");
  });
  reload.addEventListener("click", loadAll);
  if (sessionStorage.getItem(TOKEN_KEY)) loadAll(); else render();
})();
</script>
</body>
</html>`;

const config = loadPlatformAdminRuntimeConfig();
const store = new DynamoPlatformAdminStore(
  dynamoDocumentClient,
  config.CONTROL_TABLE,
  config.DATA_TABLE,
  new S3MediaStore(s3Client, { bucket: config.MEDIA_BUCKET }),
);
const openAiCredentialVault = new KmsDynamoOpenAICredentialVault(dynamoDocumentClient, kmsClient, {
  keyArn: config.PROVIDER_CREDENTIALS_KEY_ARN,
  stage: config.STAGE,
  tableName: config.CONTROL_TABLE,
});

export const main = createPlatformAdminHandler({
  platformAdmin: new PlatformAdmin(store, openAiCredentialVault),
  stage: config.STAGE,
});
