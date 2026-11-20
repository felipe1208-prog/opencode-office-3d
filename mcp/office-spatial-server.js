#!/usr/bin/env node
/**
 * Servidor MCP local (stdio, JSON-RPC 2.0) sin dependencias externas
 * para dotar de conciencia espacial 3D a los agentes de OpenCode.
 *
 * Expone:
 *   - observar_oficina(agente)
 *   - moverse_a(agente, destino, motivo)
 *   - escribir_en_pizarra(agente, nota)
 */

const BRIDGE_URL = (process.env.OFFICE_BRIDGE_URL || "http://127.0.0.1:4097").replace(/\/+$/, "");
const SERVER_INFO = {
  name: "office-spatial",
  version: "1.0.0",
};
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"];

const AGENT_ENUM = ["architect", "frontend", "qa", "backend", "systems"];
const AGENT_ALIASES = {
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
  return AGENT_ALIASES[norm] || null;
}

const TOOLS = [
  {
    name: "observar_oficina",
    description:
      "Consulta la ubicación actual del agente en la oficina 3D (zona, coordenadas x/z, postura), los objetos cercanos a su alcance (<= 2.5m), el contenido visible de la pizarra de arquitectura si está cerca y los compañeros cercanos.",
    inputSchema: {
      type: "object",
      properties: {
        agente: {
          type: "string",
          description:
            "ID o alias del agente que observa: architect (Tech Lead), frontend, backend, qa o systems.",
          enum: AGENT_ENUM,
        },
      },
      required: ["agente"],
    },
  },
  {
    name: "moverse_a",
    description:
      "Desplaza al agente por los pasillos de la oficina 3D hacia una zona, mobiliario o compañero cercano (ej. escritorio, pizarra, sala_reuniones, cafe, lounge, ping_pong, arcade, frontend, backend, qa, systems, architect).",
    inputSchema: {
      type: "object",
      properties: {
        agente: {
          type: "string",
          description: "ID del agente que se desplaza (architect, frontend, qa, backend, systems).",
          enum: AGENT_ENUM,
        },
        destino: {
          type: "string",
          description:
            "Destino dentro de la oficina: escritorio, pizarra, sala_reuniones, cafe, agua, nevera, lounge, ping_pong, arcade, librero, o el ID de un compañero (architect, frontend, qa, backend, systems).",
        },
        motivo: {
          type: "string",
          description:
            "Motivo breve y humano del desplazamiento para la burbuja discreta en 3D (opcional, máx. 60 caracteres).",
        },
      },
      required: ["agente", "destino"],
    },
  },
  {
    name: "escribir_en_pizarra",
    description:
      "Camina a la Sala de Reuniones y publica una nota breve de arquitectura o decisión técnica en la pizarra compartida 3D del equipo.",
    inputSchema: {
      type: "object",
      properties: {
        agente: {
          type: "string",
          description: "ID del agente que escribe en la pizarra (architect, frontend, qa, backend, systems).",
          enum: AGENT_ENUM,
        },
        nota: {
          type: "string",
          description:
            "Texto breve de la nota técnica o decisión a publicar en la pizarra (recomendado <= 140 caracteres).",
        },
      },
      required: ["agente", "nota"],
    },
  },
  {
    name: "leer_pizarra",
    description:
      "Consulta desde cualquier lugar de la oficina todas las notas vigentes y decisiones de arquitectura publicadas en la Pizarra de Arquitectura (tanto por compañeros como por el Tech Lead humano).",
    inputSchema: {
      type: "object",
      properties: {
        agente: {
          type: "string",
          description: "ID opcional del agente que consulta la pizarra (architect, frontend, qa, backend, systems).",
          enum: AGENT_ENUM,
        },
      },
    },
  },
  {
    name: "pedir_revision_a",
    description:
      "Solicita una revisión técnica o validación real a un compañero del equipo: el avatar camina hasta el escritorio del destinatario en 3D y registra la solicitud con contexto y archivos en su hilo para que pueda actuar sobre ella.",
    inputSchema: {
      type: "object",
      properties: {
        agente: {
          type: "string",
          description: "ID del agente que solicita la revisión (architect, frontend, qa, backend, systems).",
          enum: AGENT_ENUM,
        },
        destinatario: {
          type: "string",
          description: "ID del compañero al que se solicita revisión (architect, frontend, qa, backend, systems).",
          enum: AGENT_ENUM,
        },
        contexto: {
          type: "string",
          description:
            "Resumen concreto de lo que necesitas revisar o validar (ej. contrato API, esquema, test o componente UI).",
        },
        archivos: {
          type: "array",
          items: { type: "string" },
          description: "Lista opcional de rutas de archivos relevantes para la revisión.",
        },
      },
      required: ["agente", "destinatario", "contexto"],
    },
  },
];

let detectedContentLengthFraming = false;

function sendMessage(payload) {
  const json = JSON.stringify(payload);
  if (detectedContentLengthFraming) {
    const byteLen = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    return;
  }
  process.stdout.write(`${json}\n`);
}

function sendResult(id, result) {
  if (id === undefined || id === null) return;
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  if (id === undefined || id === null) return;
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: data !== undefined ? { code, message, data } : { code, message },
  });
}

function formatBridgeOfflineError(err) {
  return (
    `No se pudo conectar con el puente espacial de la oficina en ${BRIDGE_URL}. ` +
    `Asegúrate de tener corriendo \`npm run opencode:bridge\` (${err?.message || "conexión rechazada"}).`
  );
}

async function fetchBridgeJson(path, options = {}) {
  const resp = await fetch(`${BRIDGE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(4000),
  });
  const text = await resp.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(parsed?.error || `HTTP ${resp.status} en ${path}`);
  }
  return parsed;
}

function formatClock(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

function formatObservationText(agentId, snapshot) {
  const agent = snapshot?.agents?.[agentId];
  if (!agent) {
    return `No encontré estado espacial reciente para "${agentId}" en la oficina 3D.`;
  }

  const posX = Number(agent.position?.x ?? 0).toFixed(2);
  const posZ = Number(agent.position?.z ?? 0).toFixed(2);
  const sourceLabel =
    snapshot?.source === "live-3d"
      ? "escena 3D en vivo"
      : "estado base de estaciones (abre la oficina 3D para coordenadas en vivo)";

  const lines = [
    `Percepción espacial de ${agent.name} (@${agent.id}) [${sourceLabel}]:`,
    `- Ubicación actual: ${agent.locationLabel || agent.zoneName} (zona: ${agent.zoneName}, coordenadas x=${posX}, z=${posZ}).`,
    `- Postura y actividad: ${agent.posture || "disponible"}; ${agent.actionLabel || "en su lugar"}${agent.isMoving && agent.targetLocation ? ` (yendo hacia ${agent.targetLocation})` : ""}.`,
  ];

  const objs = Array.isArray(agent.nearbyObjects) ? agent.nearbyObjects : [];
  if (objs.length > 0) {
    const objList = objs
      .map((o) => `${o.label} (${o.distanceM}m — ${o.state})`)
      .join("; ");
    lines.push(`- Objetos al alcance (<= 2.5m): ${objList}.`);
  } else {
    lines.push("- Objetos al alcance (<= 2.5m): ninguno inmediato en este paso.");
  }

  const peers = Array.isArray(agent.nearbyPeers) ? agent.nearbyPeers : [];
  if (peers.length > 0) {
    const peerList = peers
      .map(
        (p) =>
          `${p.name} (@${p.id}, ${p.distanceM}m, ${p.sameZone ? "misma zona" : p.zoneName}: ${p.activity})`,
      )
      .join("; ");
    lines.push(`- Compañeros cercanos: ${peerList}.`);
  } else {
    lines.push("- Compañeros cercanos: no hay otros agentes en tu zona ni a menos de 4.5m.");
  }

  const notes = Array.isArray(snapshot?.whiteboard?.notes) ? snapshot.whiteboard.notes : [];
  if (agent.whiteboardNear) {
    if (notes.length > 0) {
      lines.push("- Notas visibles en la Pizarra de Arquitectura:");
      for (const n of notes.slice(0, 6)) {
        const hhmm = formatClock(n.createdAt);
        lines.push(`  • [${n.agentName || n.agentId}${hhmm ? ` ${hhmm}` : ""}] ${n.text}`);
      }
    } else {
      lines.push("- Pizarra de Arquitectura: estás cerca y actualmente no tiene notas publicadas.");
    }
  } else if (notes.length > 0) {
    lines.push(
      `- Pizarra de Arquitectura: no estás en la Sala de Reuniones (hay ${notes.length} nota(s) publicadas; puedes acercarte a \`pizarra\` para leerlas o publicar una con \`escribir_en_pizarra\`).`,
    );
  }

  return lines.join("\n");
}

async function executeTool(name, args = {}) {
  if (name === "observar_oficina") {
    const agentId = resolveAgentId(args.agente ?? args.agent ?? args.agentId);
    if (!agentId) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Agente inválido "${args.agente || ""}". Usa uno de: ${AGENT_ENUM.join(", ")}.`,
          },
        ],
      };
    }

    try {
      const snapshot = await fetchBridgeJson("/api/office/spatial-state", { method: "GET" });
      return {
        content: [
          {
            type: "text",
            text: formatObservationText(agentId, snapshot),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBridgeOfflineError(err) }],
      };
    }
  }

  if (name === "moverse_a") {
    const agentId = resolveAgentId(args.agente ?? args.agent ?? args.agentId);
    const destino = String(args.destino ?? args.destination ?? "").trim();
    const motivo = String(args.motivo ?? args.reason ?? "").trim();

    if (!agentId) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Agente inválido "${args.agente || ""}". Usa uno de: ${AGENT_ENUM.join(", ")}.`,
          },
        ],
      };
    }
    if (!destino) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Debes especificar un destino (ej. escritorio, pizarra, cafe, lounge, ping_pong, o el ID de un compañero).",
          },
        ],
      };
    }

    try {
      const res = await fetchBridgeJson("/api/office/spatial-command", {
        method: "POST",
        body: JSON.stringify({
          type: "move",
          agentId,
          destination: destino,
          reason: motivo,
        }),
      });
      const cmd = res?.command || {};
      return {
        content: [
          {
            type: "text",
            text: `Listo: ${cmd.agentName || agentId} se está desplazando en la oficina 3D hacia "${destino}"${motivo ? ` (${motivo})` : ""}.`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBridgeOfflineError(err) }],
      };
    }
  }

  if (name === "escribir_en_pizarra") {
    const agentId = resolveAgentId(args.agente ?? args.agent ?? args.agentId);
    const nota = String(args.nota ?? args.note ?? args.text ?? "").trim();

    if (!agentId) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Agente inválido "${args.agente || ""}". Usa uno de: ${AGENT_ENUM.join(", ")}.`,
          },
        ],
      };
    }
    if (!nota) {
      return {
        isError: true,
        content: [{ type: "text", text: "Debes incluir el texto de la nota para la pizarra." }],
      };
    }

    try {
      const res = await fetchBridgeJson("/api/office/spatial-command", {
        method: "POST",
        body: JSON.stringify({
          type: "write_whiteboard",
          agentId,
          note: nota,
        }),
      });
      const cmd = res?.command || {};
      const total = Array.isArray(res?.whiteboard?.notes) ? res.whiteboard.notes.length : 1;
      return {
        content: [
          {
            type: "text",
            text: `${cmd.agentName || agentId} se dirige a la Sala de Reuniones y publicó la nota en la Pizarra de Arquitectura: "${cmd.note || nota}" (${total} nota(s) visibles en pizarra).`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBridgeOfflineError(err) }],
      };
    }
  }

  if (name === "leer_pizarra") {
    try {
      const res = await fetchBridgeJson("/api/office/whiteboard", { method: "GET" });
      const notes = Array.isArray(res?.notes) ? res.notes : [];
      const proj = res?.projectDir ? ` (${res.projectDir})` : "";
      if (notes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `La Pizarra de Arquitectura${proj} no tiene notas activas en este momento.`,
            },
          ],
        };
      }
      const lines = [`Pizarra de Arquitectura${proj} (${notes.length} nota(s) vigentes):`];
      for (const n of notes) {
        const hhmm = formatClock(n.createdAt);
        const author = n.authorType === "human" ? `${n.agentName || "Tech Lead (Usuario)"} [Humano]` : (n.agentName || n.agentId);
        lines.push(`- [${author}${hhmm ? ` · ${hhmm}` : ""}] ${n.text}`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBridgeOfflineError(err) }],
      };
    }
  }

  if (name === "pedir_revision_a") {
    const fromAgentId = resolveAgentId(args.agente ?? args.agent ?? args.agentId);
    const toAgentId = resolveAgentId(args.destinatario ?? args.to ?? args.target ?? args.reviewer);
    const contexto = String(args.contexto ?? args.context ?? args.message ?? "").trim();
    const archivos = Array.isArray(args.archivos ?? args.files)
      ? (args.archivos ?? args.files).map((f) => String(f || "").trim()).filter(Boolean).slice(0, 10)
      : [];

    if (!fromAgentId) {
      return {
        isError: true,
        content: [{ type: "text", text: `Agente emisor inválido "${args.agente || ""}". Usa: ${AGENT_ENUM.join(", ")}.` }],
      };
    }
    if (!toAgentId || toAgentId === fromAgentId) {
      return {
        isError: true,
        content: [{ type: "text", text: `Destinatario inválido "${args.destinatario || ""}". Debe ser otro miembro distinto de ${fromAgentId}.` }],
      };
    }
    if (!contexto) {
      return {
        isError: true,
        content: [{ type: "text", text: "Debes incluir un resumen en `contexto` explicando qué revisar." }],
      };
    }

    try {
      const res = await fetchBridgeJson("/api/office/peer-review", {
        method: "POST",
        body: JSON.stringify({
          fromAgentId,
          toAgentId,
          context: contexto,
          files: archivos,
        }),
      });
      const review = res?.review || {};
      const filesSuffix = archivos.length > 0 ? ` (archivos: ${archivos.join(", ")})` : "";
      return {
        content: [
          {
            type: "text",
            text: `Solicitud de revisión enviada de ${review.fromAgentName || fromAgentId} hacia ${review.toAgentName || toAgentId}${filesSuffix}. El avatar se acerca a su escritorio en 3D y el contexto quedó compartido en su hilo.`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: formatBridgeOfflineError(err) }],
      };
    }
  }

  return {
    isError: true,
    content: [{ type: "text", text: `Herramienta desconocida: ${name}` }],
  };
}

async function handleRequest(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;

  const { id, method, params } = msg;

  // Notificaciones sin id
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return;
  }

  if (method === "initialize") {
    const requestedVersion = params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
      ? requestedVersion
      : SUPPORTED_PROTOCOL_VERSIONS[0];

    sendResult(id, {
      protocolVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: SERVER_INFO,
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools: TOOLS });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    if (!toolName) {
      sendError(id, -32602, "Falta params.name en tools/call");
      return;
    }
    const result = await executeTool(toolName, toolArgs);
    sendResult(id, result);
    return;
  }

  if (id !== undefined && id !== null) {
    sendError(id, -32601, `Método JSON-RPC no soportado: ${method}`);
  }
}

function dispatchRawJson(rawJson) {
  const trimmed = rawJson.trim();
  if (!trimmed) return;
  let msg = null;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    sendError(null, -32700, "JSON inválido en entrada stdio");
    return;
  }

  handleRequest(msg).catch((err) => {
    console.error("[office-spatial-mcp] Error procesando solicitud:", err);
    if (msg?.id !== undefined && msg?.id !== null) {
      sendError(msg.id, -32603, err?.message || "Error interno en servidor MCP");
    }
  });
}

let inputBuffer = Buffer.alloc(0);

function drainInputBuffer() {
  while (inputBuffer.length > 0) {
    // Detectar framing Content-Length (estilo LSP) si el cliente lo usa
    const headPreview = inputBuffer.subarray(0, 64).toString("utf8");
    if (/^\s*Content-Length:/i.test(headPreview)) {
      const headerEndCrlf = inputBuffer.indexOf("\r\n\r\n");
      const headerEndLf = inputBuffer.indexOf("\n\n");
      let headerEnd = -1;
      let sepLen = 0;
      if (headerEndCrlf !== -1 && (headerEndLf === -1 || headerEndCrlf < headerEndLf)) {
        headerEnd = headerEndCrlf;
        sepLen = 4;
      } else if (headerEndLf !== -1) {
        headerEnd = headerEndLf;
        sepLen = 2;
      }
      if (headerEnd === -1) return;

      const headerStr = inputBuffer.subarray(0, headerEnd).toString("utf8");
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        inputBuffer = inputBuffer.subarray(headerEnd + sepLen);
        continue;
      }
      const bodyLen = Number(match[1]);
      const totalNeeded = headerEnd + sepLen + bodyLen;
      if (inputBuffer.length < totalNeeded) return;

      detectedContentLengthFraming = true;
      const bodyStr = inputBuffer.subarray(headerEnd + sepLen, totalNeeded).toString("utf8");
      inputBuffer = inputBuffer.subarray(totalNeeded);
      dispatchRawJson(bodyStr);
      continue;
    }

    // Framing estándar MCP: NDJSON por línea (\n)
    const nlIndex = inputBuffer.indexOf(10);
    if (nlIndex === -1) return;
    const line = inputBuffer.subarray(0, nlIndex).toString("utf8");
    inputBuffer = inputBuffer.subarray(nlIndex + 1);
    if (line.trim()) {
      dispatchRawJson(line);
    }
  }
}

process.stdin.on("data", (chunk) => {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
  inputBuffer = Buffer.concat([inputBuffer, buf]);
  drainInputBuffer();
});

process.stdin.on("end", () => {
  if (inputBuffer.length > 0) {
    const rest = inputBuffer.toString("utf8").trim();
    if (rest.startsWith("{")) dispatchRawJson(rest);
  }
  setTimeout(() => process.exit(0), 25);
});

process.stdout.on("error", (err) => {
  if (err?.code === "EPIPE") process.exit(0);
});
