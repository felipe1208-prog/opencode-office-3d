import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";
import { agentProfileManager } from "../state/officeWorkspace.js";
import { DEFAULT_AGENT_ALIASES } from "./openCodeTemplates.js";

const STORAGE_KEY = "oficina3d:opencode_config:v1";
const WATCHDOG_SILENCE_MS = 30000;
const WATCHDOG_CHECK_INTERVAL_MS = 5000;
const AGENT_THROTTLE_MS = 250;

const TOOL_LABELS_ES = {
  read: "Leyendo código",
  edit: "Editando archivo",
  write: "Escribiendo código",
  patch: "Aplicando parche",
  bash: "Ejecutando terminal",
  grep: "Buscando referencias",
  glob: "Explorando archivos",
  list: "Listando directorio",
  task: "Delegando subtarea",
  webfetch: "Consultando docs",
  todowrite: "Actualizando plan",
};

function safeReadConfig() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteConfig(cfg) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignorar error de cuota
  }
}

function cloneDefaultAliases() {
  return Object.fromEntries(
    Object.entries(DEFAULT_AGENT_ALIASES).map(([id, list]) => [id, [...list]]),
  );
}

function normalizeToken(val) {
  return String(val || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[\s_]+/g, "-");
}

function shortFileName(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return null;
  const cleaned = rawPath.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return cleaned;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export class OpenCodeBridgeClient {
  constructor() {
    this.config = this._loadConfig();

    // Estado de conexión
    this.status = "disconnected"; // disconnected | connecting | connected | error
    this.apiPrefix = "/api"; // API v2 (/api/session, /api/event) con autodetección
    this.lastError = null;
    this.eventsReceived = 0;
    this.lastEventAt = null;
    this.lastChunkAt = 0;
    this.reconnectAttempts = 0;
    this.manualDisconnect = false;

    // Controladores de stream y timers
    this.abortController = null;
    this.watchdogTimer = null;
    this.reconnectTimer = null;

    // Registros de resolución 3-niveles (task / parentID / root)
    this.sessionsById = new Map();
    this.taskCallsByChildSession = new Map();
    this.taskCallsByPartId = new Map();
    this.activeAgents = new Set();

    // Cola de throttling por agente para proteger CanvasTexture de monitores 3D
    this.lastAgentEmitAt = new Map();
    this.pendingAgentBuffer = new Map();
    this.pendingFlushTimers = new Map();
  }

  _loadConfig() {
    const saved = safeReadConfig();
    const defaultAliases = cloneDefaultAliases();
    const mergedAliases = {};

    for (const [id, list] of Object.entries(defaultAliases)) {
      const savedList = saved?.aliases?.[id];
      mergedAliases[id] =
        Array.isArray(savedList) && savedList.length > 0
          ? savedList.map((item) => String(item).trim()).filter(Boolean)
          : list;
    }

    return {
      mode: saved?.mode === "bridge" ? "bridge" : "direct",
      directUrl:
        typeof saved?.directUrl === "string" && saved.directUrl.trim()
          ? saved.directUrl.trim().replace(/\/+$/, "")
          : "http://127.0.0.1:4096",
      bridgeUrl:
        typeof saved?.bridgeUrl === "string" && saved.bridgeUrl.trim()
          ? saved.bridgeUrl.trim().replace(/\/+$/, "")
          : "http://127.0.0.1:4097",
      username: typeof saved?.username === "string" ? saved.username : "",
      password: typeof saved?.password === "string" ? saved.password : "",
      idleCooldownSec:
        typeof saved?.idleCooldownSec === "number"
          ? Math.max(5, Math.min(60, saved.idleCooldownSec))
          : 15,
      autoReconnect: saved?.autoReconnect !== false,
      aliases: mergedAliases,
    };
  }

  _saveConfig() {
    safeWriteConfig(this.config);
  }

  getConfig() {
    return {
      ...this.config,
      aliases: Object.fromEntries(
        Object.entries(this.config.aliases).map(([k, v]) => [k, [...v]]),
      ),
    };
  }

  updateConfig(patch = {}) {
    if (patch.mode === "direct" || patch.mode === "bridge") {
      this.config.mode = patch.mode;
    }
    if (typeof patch.directUrl === "string" && patch.directUrl.trim()) {
      this.config.directUrl = patch.directUrl.trim().replace(/\/+$/, "");
    }
    if (typeof patch.bridgeUrl === "string" && patch.bridgeUrl.trim()) {
      this.config.bridgeUrl = patch.bridgeUrl.trim().replace(/\/+$/, "");
    }
    if (typeof patch.username === "string") {
      this.config.username = patch.username;
    }
    if (typeof patch.password === "string") {
      this.config.password = patch.password;
    }
    if (typeof patch.idleCooldownSec === "number") {
      this.config.idleCooldownSec = Math.max(
        5,
        Math.min(60, Math.round(patch.idleCooldownSec)),
      );
    }
    if (typeof patch.autoReconnect === "boolean") {
      this.config.autoReconnect = patch.autoReconnect;
    }
    if (patch.aliases && typeof patch.aliases === "object") {
      for (const [id, val] of Object.entries(patch.aliases)) {
        if (!this.config.aliases[id]) continue;
        const list = Array.isArray(val)
          ? val
          : String(val || "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
        this.config.aliases[id] = list.length > 0 ? list : [id];
      }
    }

    this._saveConfig();
    this._emitConnectionState();
    return this.getConfig();
  }

  resetAliases() {
    this.config.aliases = cloneDefaultAliases();
    this._saveConfig();
    this._emitConnectionState();
    return this.getConfig();
  }

  getActiveBaseUrl() {
    return this.config.mode === "bridge"
      ? this.config.bridgeUrl
      : this.config.directUrl;
  }

  _buildAuthHeaders() {
    const headers = {};
    if (this.config.username || this.config.password) {
      const creds = `${this.config.username}:${this.config.password}`;
      const encoded =
        typeof btoa === "function"
          ? btoa(creds)
          : Buffer.from(creds).toString("base64");
      headers.Authorization = `Basic ${encoded}`;
    }
    return headers;
  }

  getSnapshot() {
    return {
      status: this.status,
      mode: this.config.mode,
      url: this.getActiveBaseUrl(),
      lastError: this.lastError,
      eventsReceived: this.eventsReceived,
      lastEventAt: this.lastEventAt,
      activeAgents: Array.from(this.activeAgents),
      sessionsCount: this.sessionsById.size,
    };
  }

  _emitConnectionState() {
    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_CONNECTION,
      this.getSnapshot(),
      "opencode-bridge",
    );
  }

  /**
   * Resuelve un nombre o texto (e.g. "@frontend", "code-reviewer", "Maya")
   * contra los 5 agentes configurados y sus alias en vivo.
   */
  resolveAgentId(rawHint) {
    if (!rawHint || typeof rawHint !== "string") return null;
    const normalized = normalizeToken(rawHint);
    if (!normalized) return null;

    // 1. Coincidencia exacta por ID o alias configurado
    for (const [agentId, aliasList] of Object.entries(this.config.aliases)) {
      if (normalized === agentId) return agentId;
      for (const alias of aliasList) {
        if (normalized === normalizeToken(alias)) return agentId;
      }
    }

    // 2. Coincidencia contra nombres personalizados en el Perfil de la oficina
    const profiles = agentProfileManager.getProfiles();
    for (const prof of profiles) {
      if (normalizeToken(prof.name) === normalized) return prof.id;
    }

    // 3. Búsqueda por @mención o subcadena en títulos/descripciones
    const mentionMatch = rawHint.match(/@([a-zA-Z0-9_-]+)/);
    if (mentionMatch) {
      const fromMention = this.resolveAgentId(mentionMatch[1]);
      if (fromMention) return fromMention;
    }

    for (const [agentId, aliasList] of Object.entries(this.config.aliases)) {
      for (const alias of aliasList) {
        const cleanAlias = normalizeToken(alias);
        if (cleanAlias.length >= 2 && normalized.includes(cleanAlias)) {
          return agentId;
        }
      }
    }

    return null;
  }

  /**
   * Blindaje 1: Cascada exacta de 3 niveles para distinguir primario vs subagente.
   */
  _resolveEventAgentId(eventType, props = {}) {
    const part = props.part || props;
    const sessionId =
      part?.sessionID ||
      props.sessionID ||
      props.info?.id ||
      props.session?.id ||
      null;

    // Nivel 1: part.agent o argumento subagent_type dentro de tool === "task"
    const partInput = part?.state?.input || part?.input || {};
    const partMeta = part?.state?.metadata || part?.metadata || {};
    const tier1Candidate =
      part?.agent ||
      (part?.tool === "task"
        ? partInput.subagent_type || partInput.agent || partMeta.agent
        : null);

    const tier1Resolved = this.resolveAgentId(tier1Candidate);
    if (tier1Resolved) {
      const partKey = part?.callID || part?.id;
      if (partKey) this.taskCallsByPartId.set(partKey, tier1Resolved);
      if (partMeta.sessionId) {
        this.taskCallsByChildSession.set(partMeta.sessionId, tier1Resolved);
      }
      return tier1Resolved;
    }

    // Si pertenece a un callID previo de tool="task"
    const knownPartAgent =
      this.taskCallsByPartId.get(part?.callID || part?.id) || null;
    if (knownPartAgent) return knownPartAgent;

    // Evento explícito directo (por webhook /office-event o testing)
    const directAgent = this.resolveAgentId(props.agentId || props.agent);
    if (directAgent) return directAgent;

    // Nivel 2: Metadatos de sesión hija si tiene parentID
    if (sessionId) {
      const childTaskAgent = this.taskCallsByChildSession.get(sessionId);
      if (childTaskAgent) return childTaskAgent;

      const session = this.sessionsById.get(sessionId);
      if (session?.parentID) {
        const fromChildMeta =
          this.resolveAgentId(session.agent) ||
          this.resolveAgentId(session.title);
        if (fromChildMeta) return fromChildMeta;
      }

      // Nivel 3: Fallback al agente primario asignado a la sesión raíz
      let cursor = session;
      const visited = new Set();
      while (cursor?.parentID && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        const parent = this.sessionsById.get(cursor.parentID);
        if (!parent) break;
        cursor = parent;
      }

      if (cursor) {
        const fromRoot =
          this.resolveAgentId(cursor.agent) ||
          this.resolveAgentId(cursor.title);
        if (fromRoot) return fromRoot;
      }
    }

    // Fallback final al Tech Lead primario si hay actividad sin etiqueta
    if (
      eventType.startsWith("session.") ||
      eventType === "message.part.updated" ||
      eventType === "message.updated"
    ) {
      return "architect";
    }

    return null;
  }

  _upsertSessionRecord(sessionObj) {
    if (!sessionObj?.id) return;
    const prev = this.sessionsById.get(sessionObj.id) || {};
    const agentHint =
      sessionObj.agent ||
      sessionObj.mode ||
      sessionObj.metadata?.agent ||
      prev.agent ||
      null;
    const title = sessionObj.title || prev.title || "";
    const parentID = sessionObj.parentID || prev.parentID || null;

    this.sessionsById.set(sessionObj.id, {
      id: sessionObj.id,
      parentID,
      agent: agentHint,
      title,
    });

    // Si es sesión hija, cachear si el título o agent ya identifica un subagente
    if (parentID) {
      const resolvedChild =
        this.resolveAgentId(agentHint) || this.resolveAgentId(title);
      if (resolvedChild) {
        this.taskCallsByChildSession.set(sessionObj.id, resolvedChild);
      }
    }
  }

  /**
   * Normaliza cualquier frame SSE proveniente de OpenCode `/event` o del puente `/office-event`.
   */
  ingestEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") return null;

    // Algunos proxies/endpoints globales envuelven { directory, payload: { type, properties } }
    const evt =
      rawEvent.payload && rawEvent.payload.type ? rawEvent.payload : rawEvent;

    const eventType = evt.type || "unknown";
    const props = evt.properties || evt.data || evt;

    this.eventsReceived += 1;
    this.lastEventAt = Date.now();

    if (eventType === "server.connected" || eventType === "server.heartbeat") {
      return null;
    }

    if (eventType === "session.created" || eventType === "session.updated") {
      const info = props.info || props.session || props;
      this._upsertSessionRecord(info);
      const resolved = this._resolveEventAgentId(eventType, {
        ...props,
        info,
      });
      if (resolved && info?.status?.type === "busy") {
        this._queueAgentTask(resolved, {
          status: "started",
          label: info.title ? info.title.slice(0, 32) : "Sesión OpenCode activa",
          file: null,
        });
      }
      return resolved;
    }

    if (eventType === "session.status") {
      const statusType = props.status?.type || props.status;
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (statusType === "busy" || statusType === "running") {
        this._queueAgentTask(agentId, {
          status: "started",
          label: "Procesando prompt OpenCode",
          file: null,
        });
      } else if (statusType === "idle") {
        this._queueAgentTask(
          agentId,
          {
            status: "passed",
            label: "Sesión completada",
            file: null,
          },
          { immediate: true },
        );
      }
      return agentId;
    }

    if (eventType === "session.idle") {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      this._queueAgentTask(
        agentId,
        {
          status: "passed",
          label: "Tarea finalizada",
          file: null,
        },
        { immediate: true },
      );
      return agentId;
    }

    if (eventType === "session.error") {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      const errMsg =
        props.error?.data?.message ||
        props.error?.name ||
        props.message ||
        "Error en sesión OpenCode";
      this._queueAgentTask(
        agentId,
        {
          status: "failed",
          label: String(errMsg).slice(0, 34),
          file: null,
        },
        { immediate: true },
      );
      return agentId;
    }

    if (eventType === "permission.updated" || eventType === "permission.asked") {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      this._queueAgentTask(
        agentId,
        {
          status: "failed",
          label: "Esperando permiso CLI",
          file: shortFileName(props.pattern || props.title),
        },
        { immediate: true },
      );
      return agentId;
    }

    if (eventType === "message.updated") {
      const info = props.info || props;
      if (info?.sessionID && info?.agent) {
        const existing = this.sessionsById.get(info.sessionID) || {
          id: info.sessionID,
          parentID: null,
          title: "",
        };
        existing.agent = info.agent;
        this.sessionsById.set(info.sessionID, existing);
      }
      return this._resolveEventAgentId(eventType, props);
    }

    if (eventType === "message.part.updated") {
      const part = props.part || props;
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (part.type === "tool") {
        const toolName = String(part.tool || "tool").toLowerCase();
        const stateStatus = part.state?.status || "running";
        const input = part.state?.input || part.input || {};
        const file = shortFileName(
          input.filePath ||
            input.path ||
            input.pattern ||
            (input.command ? `$ ${String(input.command).slice(0, 24)}` : null),
        );

        // Si tool="task" delega a un subagente, también notificar al agente primario
        if (toolName === "task") {
          const parentAgent =
            this.resolveAgentId(
              this.sessionsById.get(part.sessionID)?.agent,
            ) || "architect";
          if (parentAgent && parentAgent !== agentId) {
            this._queueAgentTask(parentAgent, {
              status: "started",
              label: `Coordinando @${agentId}`,
              file: input.description ? String(input.description).slice(0, 30) : null,
            });
          }
        }

        if (stateStatus === "error") {
          this._queueAgentTask(
            agentId,
            {
              status: "failed",
              label: `Fallo en ${toolName}`,
              file,
            },
            { immediate: true },
          );
        } else if (stateStatus === "completed" && toolName === "task") {
          this._queueAgentTask(
            agentId,
            {
              status: "passed",
              label: "Subtarea completada",
              file,
            },
            { immediate: true },
          );
        } else {
          const label = TOOL_LABELS_ES[toolName] || `Tool: ${toolName}`;
          this._queueAgentTask(agentId, {
            status: "started",
            label,
            file,
          });
        }
        return agentId;
      }

      if (part.type === "text" || part.type === "reasoning") {
        this._queueAgentTask(agentId, {
          status: "started",
          label:
            part.type === "reasoning"
              ? "Analizando solución"
              : "Redactando respuesta",
          file: null,
        });
      }
      return agentId;
    }

    // Webhook personalizado vía puente local (/office-event)
    if (eventType === "office.agent_event" || props.agentId) {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      this._queueAgentTask(
        agentId,
        {
          status: props.status || "started",
          label: props.label || "Evento OpenCode",
          file: shortFileName(props.file),
        },
        { immediate: props.status === "passed" || props.status === "failed" },
      );
      return agentId;
    }

    return null;
  }

  /**
   * Blindaje 2 (Backpressure): Coalesce ráfagas de tokens por agente cada 250ms
   * salvo transiciones críticas (passed/failed) para no saturar CanvasTexture.
   */
  _queueAgentTask(agentId, payload, { immediate = false } = {}) {
    if (!agentId) return;

    if (payload.status === "started") {
      this.activeAgents.add(agentId);
    } else if (payload.status === "passed" || payload.status === "failed") {
      this.activeAgents.delete(agentId);
    }

    const enriched = {
      agentId,
      status: payload.status || "started",
      label: payload.label || "Trabajando en OpenCode",
      file: payload.file || null,
      live: true,
      idleCooldownSec: this.config.idleCooldownSec,
    };

    const existingTimer = this.pendingFlushTimers.get(agentId);
    const now = Date.now();
    const lastEmit = this.lastAgentEmitAt.get(agentId) || 0;

    if (immediate) {
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.pendingFlushTimers.delete(agentId);
      }
      this.pendingAgentBuffer.delete(agentId);
      this._flushAgentEvent(agentId, enriched);
      return;
    }

    const prevBuffered = this.pendingAgentBuffer.get(agentId);
    const merged = {
      ...prevBuffered,
      ...enriched,
      file: enriched.file || prevBuffered?.file || null,
    };

    if (!existingTimer && now - lastEmit >= AGENT_THROTTLE_MS) {
      this._flushAgentEvent(agentId, merged);
      return;
    }

    this.pendingAgentBuffer.set(agentId, merged);

    if (!existingTimer) {
      const waitMs = Math.max(40, AGENT_THROTTLE_MS - (now - lastEmit));
      const timerId = setTimeout(() => {
        this.pendingFlushTimers.delete(agentId);
        const latest = this.pendingAgentBuffer.get(agentId);
        this.pendingAgentBuffer.delete(agentId);
        if (latest) {
          this._flushAgentEvent(agentId, latest);
        }
      }, waitMs);
      this.pendingFlushTimers.set(agentId, timerId);
    }
  }

  _flushAgentEvent(agentId, payload) {
    this.lastAgentEmitAt.set(agentId, Date.now());
    officeEventBus.emit(OFFICE_EVENTS.AGENT_TASK, payload, "opencode-sse");
    this._emitConnectionState();
  }

  _clearThrottleQueues() {
    for (const timer of this.pendingFlushTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingFlushTimers.clear();
    this.pendingAgentBuffer.clear();
  }

  async _probeSessionEndpoint(baseUrl, headers, signal) {
    const probeAt = async (prefix) => {
      const resp = await fetch(`${baseUrl}${prefix}/session`, { headers, signal });
      const contentType = (resp.headers.get("content-type") || "").toLowerCase();
      return {
        prefix,
        resp,
        isJson: contentType.includes("application/json"),
        isHtml: contentType.includes("text/html"),
      };
    };

    const primary = await probeAt("/api");
    if (primary.resp.status === 401) {
      this.apiPrefix = "/api";
      return {
        ok: false,
        prefix: "/api",
        status: 401,
        isAuthError: true,
        error: "Autenticación requerida (Basic Auth)",
      };
    }

    if (primary.resp.status === 502 && primary.isJson) {
      const errBody = await primary.resp.json().catch(() => null);
      return {
        ok: false,
        prefix: "/api",
        status: 502,
        isAuthError: false,
        error: errBody?.detail
          ? `${errBody.error || "Puente 502"} (${errBody.detail})`
          : errBody?.error || "Puente sin conexión con opencode serve",
      };
    }

    if (primary.resp.ok && primary.isJson) {
      this.apiPrefix = "/api";
      return { ok: true, prefix: "/api", status: primary.resp.status, resp: primary.resp };
    }

    if (primary.resp.status === 404 || primary.isHtml) {
      const legacy = await probeAt("");
      if (legacy.resp.status === 401) {
        this.apiPrefix = "";
        return {
          ok: false,
          prefix: "",
          status: 401,
          isAuthError: true,
          error: "Autenticación requerida (Basic Auth)",
        };
      }
      if (legacy.resp.ok && legacy.isJson) {
        this.apiPrefix = "";
        return { ok: true, prefix: "", status: legacy.resp.status, resp: legacy.resp };
      }
      if (primary.isHtml || legacy.isHtml) {
        return {
          ok: false,
          prefix: "/api",
          status: primary.resp.status,
          isAuthError: false,
          error: "El servidor devolvió HTML (SPA fallback) en lugar de JSON en /api/session",
        };
      }
    }

    return {
      ok: false,
      prefix: "/api",
      status: primary.resp.status,
      isAuthError: false,
      error: `HTTP ${primary.resp.status} en /api/session`,
    };
  }

  async testConnection() {
    const baseUrl = this.getActiveBaseUrl();
    const start = performance.now();
    const headers = {
      Accept: "application/json",
      ...this._buildAuthHeaders(),
    };

    try {
      const probe = await this._probeSessionEndpoint(
        baseUrl,
        headers,
        AbortSignal.timeout(4000),
      );

      if (!probe.ok) {
        return {
          ok: false,
          status: probe.status,
          latencyMs: Math.round(performance.now() - start),
          error: probe.error,
        };
      }

      const data = await probe.resp.json().catch(() => null);
      if (data === null) {
        return {
          ok: false,
          status: probe.status,
          latencyMs: Math.round(performance.now() - start),
          error: "Respuesta no válida (JSON corrupto en /api/session)",
        };
      }

      const list = Array.isArray(data) ? data : data?.sessions || [];
      return {
        ok: true,
        status: probe.status,
        latencyMs: Math.round(performance.now() - start),
        sessionsCount: list.length,
        apiPrefix: probe.prefix,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        latencyMs: Math.round(performance.now() - start),
        error:
          err?.name === "TimeoutError"
            ? "Tiempo de espera agotado (4s)"
            : "No accesible (verifica opencode serve / CORS o puente)",
      };
    }
  }

  async _syncInitialSessions(signal) {
    const baseUrl = this.getActiveBaseUrl();
    const headers = {
      Accept: "application/json",
      ...this._buildAuthHeaders(),
    };

    try {
      const probe = await this._probeSessionEndpoint(baseUrl, headers, signal);
      if (probe.isAuthError) {
        throw new Error("Credenciales Basic Auth inválidas (401)");
      }
      if (probe.ok) {
        const data = await probe.resp.json().catch(() => []);
        const list = Array.isArray(data) ? data : data?.sessions || [];
        for (const s of list) this._upsertSessionRecord(s);
      }

      const statusResp = await fetch(`${baseUrl}${this.apiPrefix}/session/status`, {
        headers,
        signal,
      }).catch(() => null);

      const statusCt = (statusResp?.headers?.get("content-type") || "").toLowerCase();
      if (statusResp?.ok && statusCt.includes("application/json")) {
        const statusMap = await statusResp.json().catch(() => ({}));
        if (statusMap && typeof statusMap === "object") {
          for (const [sessionId, st] of Object.entries(statusMap)) {
            if (st?.type === "busy") {
              const agentId = this._resolveEventAgentId("session.status", {
                sessionID: sessionId,
                status: st,
              });
              if (agentId) {
                this._queueAgentTask(agentId, {
                  status: "started",
                  label: "Sesión OpenCode en curso",
                  file: null,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      if (err?.message?.includes("401")) throw err;
      // No bloquear apertura SSE si /api/session/status difiere según versión
    }
  }

  _startWatchdog(controller) {
    this._stopWatchdog();
    this.lastChunkAt = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (this.manualDisconnect || controller.signal.aborted) {
        this._stopWatchdog();
        return;
      }
      if (Date.now() - this.lastChunkAt > WATCHDOG_SILENCE_MS) {
        this.lastError = "Sin latido SSE en 30s; reconectando...";
        this._emitConnectionState();
        controller.abort();
      }
    }, WATCHDOG_CHECK_INTERVAL_MS);
  }

  _stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  _abortActiveStream() {
    this._stopWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async connect() {
    this.manualDisconnect = false;
    this._abortActiveStream();

    const controller = new AbortController();
    this.abortController = controller;

    this.status = "connecting";
    this.lastError = null;
    this._emitConnectionState();

    const baseUrl = this.getActiveBaseUrl();

    try {
      await this._syncInitialSessions(controller.signal);

      const eventPath = `${this.apiPrefix}/event`;
      const resp = await fetch(`${baseUrl}${eventPath}`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...this._buildAuthHeaders(),
        },
        signal: controller.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error(
          resp.status === 401
            ? "Credenciales Basic Auth inválidas (401)"
            : `Error HTTP ${resp.status} al abrir ${eventPath}`,
        );
      }

      const contentType = (resp.headers.get("content-type") || "").toLowerCase();
      if (contentType && !contentType.includes("text/event-stream")) {
        throw new Error(
          contentType.includes("text/html")
            ? `SPA fallback HTML recibido en ${eventPath} en vez de stream SSE`
            : `Content-Type inesperado en ${eventPath}: ${contentType}`,
        );
      }

      this.status = "connected";
      this.reconnectAttempts = 0;
      this.lastError = null;
      this._emitConnectionState();
      this._startWatchdog(controller);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        this.lastChunkAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let boundaryIndex;
        while ((boundaryIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawFrame = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          this._processSseFrame(rawFrame);
        }
      }

      if (!this.manualDisconnect && this.config.autoReconnect) {
        this._scheduleReconnect("Stream SSE cerrado; reintentando...");
      }
    } catch (err) {
      if (this.manualDisconnect) return;

      if (err?.name === "AbortError") {
        if (this.config.autoReconnect && this.abortController === controller) {
          this._scheduleReconnect(
            this.lastError || "Reconectando stream SSE...",
          );
        }
        return;
      }

      const msg =
        err?.message || "No se pudo abrir el stream SSE de OpenCode";
      if (this.config.autoReconnect) {
        this._scheduleReconnect(msg);
      } else {
        this.status = "error";
        this.lastError = msg;
        this._emitConnectionState();
      }
    } finally {
      this._stopWatchdog();
    }
  }

  _processSseFrame(rawFrame) {
    if (!rawFrame || rawFrame.startsWith(":")) return;
    const dataLines = [];
    for (const line of rawFrame.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return;

    const jsonText = dataLines.join("\n").trim();
    if (!jsonText) return;

    try {
      const parsed = JSON.parse(jsonText);
      this.ingestEvent(parsed);
    } catch {
      // Ignorar frames SSE no JSON
    }
  }

  _scheduleReconnect(reason) {
    if (this.manualDisconnect) return;
    this.reconnectAttempts += 1;
    const delayMs = Math.min(12000, 1500 * 2 ** (this.reconnectAttempts - 1));
    this.status = "error";
    this.lastError = `${reason} (reintento en ${Math.round(delayMs / 1000)}s)`;
    this._emitConnectionState();

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.manualDisconnect) {
        this.connect();
      }
    }, delayMs);
  }

  disconnect() {
    this.manualDisconnect = true;
    this._abortActiveStream();
    this._clearThrottleQueues();
    this.activeAgents.clear();
    this.sessionsById.clear();
    this.taskCallsByChildSession.clear();
    this.taskCallsByPartId.clear();
    this.status = "disconnected";
    this.lastError = null;
    this._emitConnectionState();
  }

  dispose() {
    this.disconnect();
  }
}

export const openCodeBridge = new OpenCodeBridgeClient();
