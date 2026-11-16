#!/usr/bin/env node
/**
 * Puente Local sin dependencias para conectar OpenCode Server (:4096)
 * con la Oficina Virtual 3D, resolviendo CORS, Basic Auth y eventos webhook locales.
 *
 * Uso:
 *   npm run opencode:bridge
 * Variables opcionales:
 *   BRIDGE_PORT=4097
 *   OPENCODE_URL=http://127.0.0.1:4096
 *   OPENCODE_SERVER_USERNAME=opencode
 *   OPENCODE_SERVER_PASSWORD=tu_clave
 */

import http from "node:http";

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4097);
const BRIDGE_HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const OPENCODE_URL = (process.env.OPENCODE_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");

const AUTH_USER = process.env.OPENCODE_SERVER_USERNAME || "";
const AUTH_PASS = process.env.OPENCODE_SERVER_PASSWORD || "";

const sseClients = new Set();

let detectedUpstreamPrefix = "/api";

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Cache-Control");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function buildUpstreamHeaders(reqHeaders) {
  const headers = { ...reqHeaders };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  delete headers.origin;
  delete headers.referer;

  if (!headers.authorization && (AUTH_USER || AUTH_PASS)) {
    const token = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64");
    headers.authorization = `Basic ${token}`;
  }
  return headers;
}

function broadcastCustomEvent(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function probeSessionAt(pathPrefix) {
  const target = `${OPENCODE_URL}${pathPrefix}/session`;
  const resp = await fetch(target, {
    headers: buildUpstreamHeaders({ accept: "application/json" }),
    signal: AbortSignal.timeout(2500),
  });
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");
  const isHtml = contentType.includes("text/html");
  return { resp, isJson, isHtml };
}

async function probeUpstream() {
  try {
    const v2 = await probeSessionAt("/api");
    if (v2.resp.status === 401) {
      detectedUpstreamPrefix = "/api";
      return {
        ok: false,
        status: 401,
        prefix: "/api",
        error: "Autenticación requerida (Basic Auth)",
      };
    }
    if (v2.resp.ok && v2.isJson) {
      detectedUpstreamPrefix = "/api";
      return { ok: true, status: v2.resp.status, prefix: "/api", error: null };
    }

    if (v2.resp.status === 404 || v2.isHtml) {
      const legacy = await probeSessionAt("");
      if (legacy.resp.status === 401) {
        detectedUpstreamPrefix = "";
        return {
          ok: false,
          status: 401,
          prefix: "",
          error: "Autenticación requerida (Basic Auth)",
        };
      }
      if (legacy.resp.ok && legacy.isJson) {
        detectedUpstreamPrefix = "";
        return { ok: true, status: legacy.resp.status, prefix: "", error: null };
      }
      if (v2.isHtml || legacy.isHtml) {
        return {
          ok: false,
          status: v2.resp.status,
          prefix: detectedUpstreamPrefix,
          error: "OpenCode devolvió HTML (SPA fallback) en lugar de JSON (/api/session)",
        };
      }
    }

    return {
      ok: false,
      status: v2.resp.status,
      prefix: detectedUpstreamPrefix,
      error: `HTTP ${v2.resp.status} en /api/session`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      prefix: detectedUpstreamPrefix,
      error: err?.message || "Upstream unavailable",
    };
  }
}

async function handleHealth(_req, res) {
  const probe = await probeUpstream();

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      bridge: "ok",
      bridgeUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
      upstreamUrl: OPENCODE_URL,
      upstreamPrefix: probe.prefix,
      upstreamOk: probe.ok,
      upstreamStatus: probe.status,
      upstreamError: probe.error,
      clients: sseClients.size,
    }),
  );
}

async function proxyHttp(req, res, targetUrl) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const upstreamResp = await fetch(targetUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      signal: controller.signal,
    });

    const contentType = upstreamResp.headers.get("content-type") || "application/json";
    res.writeHead(upstreamResp.status, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });

    if (!upstreamResp.body) {
      res.end();
      return;
    }

    const reader = upstreamResp.body.getReader();
    const isSse = contentType.includes("text/event-stream");
    if (isSse) {
      sseClients.add(res);
    }

    const heartbeat = isSse
      ? setInterval(() => {
          try {
            res.write(": keepalive\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 15000)
      : null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) {
          res.write(value);
        }
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (isSse) sseClients.delete(res);
      if (!res.writableEnded) res.end();
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    }
    if (!res.writableEnded) {
      res.end(
        JSON.stringify({
          error: "No se pudo conectar con opencode serve",
          targetUrl,
          detail: err?.message || "Upstream unavailable",
        }),
      );
    }
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const rawUrl = req.url || "/";
  const queryIdx = rawUrl.indexOf("?");
  const reqPath = queryIdx >= 0 ? rawUrl.slice(0, queryIdx) : rawUrl;
  const query = queryIdx >= 0 ? rawUrl.slice(queryIdx) : "";

  if (reqPath === "/bridge/health") {
    await handleHealth(req, res);
    return;
  }

  // Endpoint opcional para plugins o scripts CLI que quieran inyectar eventos directos
  if (reqPath === "/office-event" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      broadcastCustomEvent(data);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, clients: sseClients.size }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "JSON inválido" }));
    }
    return;
  }

  const hasApiPrefix =
    reqPath === "/api" ||
    reqPath.startsWith("/api/") ||
    reqPath === "/openapi.json" ||
    reqPath === "/doc";
  const normalizedPath = hasApiPrefix
    ? detectedUpstreamPrefix === "" && reqPath.startsWith("/api/")
      ? reqPath.slice(4) || "/"
      : reqPath
    : detectedUpstreamPrefix
      ? `${detectedUpstreamPrefix}${reqPath.startsWith("/") ? reqPath : `/${reqPath}`}`
      : reqPath;

  await proxyHttp(req, res, `${OPENCODE_URL}${normalizedPath}${query}`);
});

server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  console.log(
    `[OpenCode Bridge] Escuchando en http://${BRIDGE_HOST}:${BRIDGE_PORT} -> ${OPENCODE_URL}`,
  );
});
