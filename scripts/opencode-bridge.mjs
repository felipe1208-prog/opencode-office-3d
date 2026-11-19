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

const MAX_WHITEBOARD_NOTES = 10;
const MAX_SPATIAL_COMMANDS = 100;

const AGENT_META = {
  architect: {
    id: "architect",
    name: "Tech Lead",
    color: "#8B5CF6",
    zoneId: "supervisor",
    zoneName: "Oficina del Tech Lead",
    locationLabel: "Escritorio del Tech Lead",
    position: { x: -8.4, z: -6.5 },
    checkpointId: "supervisor-desk",
    nearbyObjects: [
      {
        id: "desk-architect",
        label: "Escritorio del Tech Lead",
        type: "workstation",
        distanceM: 0.9,
        state: "con monitor principal y portátil de coordinación",
      },
      {
        id: "supervisor-guest-chairs",
        label: "Sillas de visita de dirección",
        type: "seating",
        distanceM: 1.9,
        state: "disponibles frente al escritorio",
      },
    ],
  },
  frontend: {
    id: "frontend",
    name: "Frontend Dev",
    color: "#E09F5A",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de Frontend Dev",
    position: { x: -6.7, z: 4.18 },
    checkpointId: "dev-pod2-nw",
    nearbyObjects: [
      {
        id: "desk-frontend",
        label: "Escritorio de Frontend Dev",
        type: "workstation",
        distanceM: 0.6,
        state: "con monitores duales WebGL",
      },
      {
        id: "desk-qa",
        label: "Escritorio de DevOps / QA",
        type: "workstation",
        distanceM: 1.5,
        state: "con monitores de pruebas",
      },
      {
        id: "desk-systems",
        label: "Escritorio de Systems Dev",
        type: "workstation",
        distanceM: 1.4,
        state: "con terminal CLI y automatización",
      },
    ],
  },
  qa: {
    id: "qa",
    name: "DevOps / QA",
    color: "#22C55E",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de DevOps / QA",
    position: { x: -5.3, z: 4.18 },
    checkpointId: "dev-pod2-ne",
    nearbyObjects: [
      {
        id: "desk-qa",
        label: "Escritorio de DevOps / QA",
        type: "workstation",
        distanceM: 0.6,
        state: "con monitores de pruebas",
      },
      {
        id: "desk-backend",
        label: "Escritorio de Backend Dev",
        type: "workstation",
        distanceM: 1.4,
        state: "con monitores de API y datos",
      },
      {
        id: "desk-frontend",
        label: "Escritorio de Frontend Dev",
        type: "workstation",
        distanceM: 1.5,
        state: "con monitores duales WebGL",
      },
    ],
  },
  backend: {
    id: "backend",
    name: "Backend Dev",
    color: "#06B6D4",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de Backend Dev",
    position: { x: -5.3, z: 6.22 },
    checkpointId: "dev-pod2-se",
    nearbyObjects: [
      {
        id: "desk-backend",
        label: "Escritorio de Backend Dev",
        type: "workstation",
        distanceM: 0.6,
        state: "con monitores de API y datos",
      },
      {
        id: "desk-systems",
        label: "Escritorio de Systems Dev",
        type: "workstation",
        distanceM: 1.5,
        state: "con terminal CLI y automatización",
      },
      {
        id: "desk-qa",
        label: "Escritorio de DevOps / QA",
        type: "workstation",
        distanceM: 1.4,
        state: "con monitores de pruebas",
      },
    ],
  },
  systems: {
    id: "systems",
    name: "Systems Dev",
    color: "#EC4899",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de Systems Dev",
    position: { x: -6.7, z: 6.22 },
    checkpointId: "dev-pod2-sw",
    nearbyObjects: [
      {
        id: "desk-systems",
        label: "Escritorio de Systems Dev",
        type: "workstation",
        distanceM: 0.6,
        state: "con terminal CLI y automatización",
      },
      {
        id: "desk-backend",
        label: "Escritorio de Backend Dev",
        type: "workstation",
        distanceM: 1.5,
        state: "con monitores de API y datos",
      },
      {
        id: "desk-frontend",
        label: "Escritorio de Frontend Dev",
        type: "workstation",
        distanceM: 1.4,
        state: "con monitores duales WebGL",
      },
    ],
  },
};

const AGENT_ALIAS_TO_ID = {
  architect: "architect",
  "tech-lead": "architect",
  techlead: "architect",
  lead: "architect",
  lider: "architect",
  jefe: "architect",
  supervisor: "architect",
  orchestrator: "architect",
  main: "architect",
  frontend: "frontend",
  "frontend-dev": "frontend",
  ui: "frontend",
  ux: "frontend",
  webgl: "frontend",
  threejs: "frontend",
  qa: "qa",
  devops: "qa",
  "devops-qa": "qa",
  reviewer: "qa",
  "code-reviewer": "qa",
  test: "qa",
  audit: "qa",
  backend: "backend",
  "backend-dev": "backend",
  api: "backend",
  server: "backend",
  servidor: "backend",
  db: "backend",
  systems: "systems",
  "systems-dev": "systems",
  cli: "systems",
  sistemas: "systems",
  automation: "systems",
  infra: "systems",
};

function resolveAgentId(rawAgent) {
  const norm = String(rawAgent || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@+/, "")
    .replace(/[\s_]+/g, "-");
  return AGENT_ALIAS_TO_ID[norm] || null;
}

function buildSeedSpatialState() {
  const now = Date.now();
  const agents = {};
  const entries = Object.values(AGENT_META);

  for (const meta of entries) {
    const nearbyPeers = entries
      .filter((other) => other.id !== meta.id && other.zoneId === meta.zoneId)
      .map((other) => ({
        id: other.id,
        name: other.name,
        distanceM: Number(
          Math.hypot(other.position.x - meta.position.x, other.position.z - meta.position.z).toFixed(1),
        ),
        sameZone: true,
        zoneName: other.zoneName,
        activity: "en su escritorio",
      }))
      .sort((a, b) => a.distanceM - b.distanceM);

    agents[meta.id] = {
      id: meta.id,
      name: meta.name,
      color: meta.color,
      zoneId: meta.zoneId,
      zoneName: meta.zoneName,
      locationLabel: meta.locationLabel,
      position: { ...meta.position },
      posture: "sentado",
      state: "WORKING",
      actionLabel: "En su escritorio",
      taskTitle: null,
      checkpointId: meta.checkpointId,
      isMoving: false,
      targetLocation: null,
      nearbyObjects: meta.nearbyObjects.map((o) => ({ ...o })),
      nearbyPeers,
      whiteboardNear: false,
      updatedAt: now,
    };
  }

  return {
    updatedAt: now,
    source: "bridge-seed",
    agents,
    whiteboard: {
      notes: [],
      updatedAt: null,
    },
  };
}

const spatialState = buildSeedSpatialState();
let spatialCommandQueue = [];
let spatialCommandSeq = 0;

function mergeWhiteboardNotes(existing = [], incoming = []) {
  const byId = new Map();
  for (const item of [...incoming, ...existing]) {
    if (!item || typeof item !== "object") continue;
    const text = String(item.text || item.note || "").trim();
    if (!text) continue;
    const id = String(item.id || `wb_${item.createdAt || Date.now()}`).trim();
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        agentId: item.agentId || "architect",
        agentName: item.agentName || item.agentId || "Tech Lead",
        color: item.color || AGENT_META[item.agentId]?.color || "#8B5CF6",
        text: text.slice(0, 220),
        createdAt: Number(item.createdAt) || Date.now(),
      });
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_WHITEBOARD_NOTES);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

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
      spatialSource: spatialState.source,
      spatialUpdatedAt: spatialState.updatedAt,
      pendingSpatialCommands: spatialCommandQueue.length,
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
  const searchParams = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);

  if (reqPath === "/bridge/health") {
    await handleHealth(req, res);
    return;
  }

  // Conciencia espacial 3D: sincronización de estado (frontend 3D <-> puente <-> MCP)
  if (reqPath === "/api/office/spatial-state" || reqPath === "/office/spatial-state") {
    if (req.method === "GET") {
      sendJson(res, 200, spatialState);
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const now = Date.now();

        if (body?.agents && typeof body.agents === "object") {
          for (const [rawId, info] of Object.entries(body.agents)) {
            const agentId = resolveAgentId(rawId) || rawId;
            if (!agentId || !info || typeof info !== "object") continue;
            spatialState.agents[agentId] = {
              ...(spatialState.agents[agentId] || {}),
              ...info,
              id: agentId,
              updatedAt: Number(info.updatedAt) || now,
            };
          }
        }

        const incomingNotes = Array.isArray(body?.whiteboard?.notes)
          ? body.whiteboard.notes
          : [];
        spatialState.whiteboard.notes = mergeWhiteboardNotes(
          spatialState.whiteboard.notes,
          incomingNotes,
        );
        spatialState.whiteboard.updatedAt =
          spatialState.whiteboard.notes[0]?.createdAt || spatialState.whiteboard.updatedAt;
        spatialState.updatedAt = Number(body?.updatedAt) || now;
        spatialState.source = body?.source || "live-3d";

        sendJson(res, 200, {
          ok: true,
          updatedAt: spatialState.updatedAt,
          whiteboard: spatialState.whiteboard,
          pendingCommandsCount: spatialCommandQueue.length,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en spatial-state" });
      }
      return;
    }
  }

  // Conciencia espacial 3D: cola + SSE de intenciones espaciales (MCP -> puente -> escena 3D)
  if (reqPath === "/api/office/spatial-command" || reqPath === "/office/spatial-command") {
    if (req.method === "GET") {
      const ackId = searchParams.get("ack");
      if (ackId) {
        spatialCommandQueue = spatialCommandQueue.filter((cmd) => cmd.id !== ackId);
      }

      const peek = searchParams.get("peek") === "1" || searchParams.get("peek") === "true";
      const commands = peek ? [...spatialCommandQueue] : spatialCommandQueue.splice(0);
      sendJson(res, 200, {
        commands,
        whiteboard: spatialState.whiteboard,
      });
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const rawType = String(body?.type || "").trim().toLowerCase();
        const type =
          rawType === "write_whiteboard" || rawType === "whiteboard" || rawType === "pizarra"
            ? "write_whiteboard"
            : "move";

        const agentId = resolveAgentId(body?.agentId || body?.agente || body?.agent);
        if (!agentId) {
          sendJson(res, 400, {
            ok: false,
            error: "Agente no reconocido. Usa architect, frontend, qa, backend o systems.",
          });
          return;
        }

        const meta = AGENT_META[agentId];
        const now = Date.now();
        spatialCommandSeq += 1;
        const commandId = `sc_${now}_${spatialCommandSeq}`;

        let command = null;
        if (type === "write_whiteboard") {
          const noteText = String(body?.note || body?.nota || body?.text || "").trim();
          if (!noteText) {
            sendJson(res, 400, {
              ok: false,
              error: "La nota para la pizarra no puede estar vacía.",
            });
            return;
          }

          const noteId = `wb_${now}_${spatialCommandSeq}`;
          const noteRecord = {
            id: noteId,
            agentId,
            agentName: meta.name,
            color: meta.color,
            text: noteText.slice(0, 220),
            createdAt: now,
          };

          spatialState.whiteboard.notes = mergeWhiteboardNotes(
            spatialState.whiteboard.notes,
            [noteRecord],
          );
          spatialState.whiteboard.updatedAt = now;

          command = {
            id: commandId,
            noteId,
            type: "write_whiteboard",
            agentId,
            agentName: meta.name,
            color: meta.color,
            note: noteRecord.text,
            createdAt: now,
          };
        } else {
          const destination = String(body?.destination || body?.destino || "").trim();
          if (!destination) {
            sendJson(res, 400, {
              ok: false,
              error: "Debes indicar un destino válido para moverte.",
            });
            return;
          }
          const reason = String(body?.reason || body?.motivo || "").trim();
          command = {
            id: commandId,
            type: "move",
            agentId,
            agentName: meta.name,
            color: meta.color,
            destination,
            reason: reason.slice(0, 80),
            createdAt: now,
          };
        }

        spatialCommandQueue.push(command);
        if (spatialCommandQueue.length > MAX_SPATIAL_COMMANDS) {
          spatialCommandQueue = spatialCommandQueue.slice(-MAX_SPATIAL_COMMANDS);
        }

        broadcastCustomEvent({
          type: "office.spatial.command",
          properties: {
            command,
            whiteboard: spatialState.whiteboard,
          },
        });

        sendJson(res, 200, {
          ok: true,
          command,
          whiteboard: spatialState.whiteboard,
          clients: sseClients.size,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en spatial-command" });
      }
      return;
    }
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
