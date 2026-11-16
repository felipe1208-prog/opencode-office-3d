import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";
import { agentProfileManager } from "../state/officeWorkspace.js";
import { DEFAULT_AGENT_ALIASES } from "./openCodeTemplates.js";

const STORAGE_KEY = "oficina3d:opencode_config:v1";
const WATCHDOG_SILENCE_MS = 30000;
const WATCHDOG_CHECK_INTERVAL_MS = 5000;
const AGENT_THROTTLE_MS = 250;
const IDLE_DEBOUNCE_MS = 3000;

const TOOL_LABELS_ES = {
  read: "Leyendo código",
  view: "Leyendo código",
  edit: "Editando archivo",
  multi_edit: "Editando archivos",
  apply_patch: "Aplicando parche",
  write: "Escribiendo código",
  patch: "Aplicando parche",
  bash: "Ejecutando terminal",
  shell: "Ejecutando terminal",
  run: "Ejecutando comando",
  grep: "Buscando referencias",
  search: "Buscando código",
  glob: "Explorando archivos",
  find: "Explorando archivos",
  list: "Listando directorio",
  ls: "Listando directorio",
  task: "Delegando subtarea",
  question: "Esperando respuesta en CLI",
  webfetch: "Consultando docs",
  fetch: "Consultando docs",
  todowrite: "Actualizando plan",
  todoread: "Leyendo plan",
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
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function formatToolTarget(input = {}) {
  if (!input || typeof input !== "object") return null;
  const pathCandidate =
    input.path || input.filePath || input.file || input.pattern;
  if (typeof pathCandidate === "string" && pathCandidate.trim()) {
    return shortFileName(pathCandidate);
  }
  if (typeof input.command === "string" && input.command.trim()) {
    return `$ ${input.command.trim().slice(0, 40)}`;
  }
  if (typeof input.url === "string" && input.url.trim()) {
    return input.url.trim().slice(0, 40);
  }
  if (typeof input.description === "string" && input.description.trim()) {
    return input.description.trim().slice(0, 40);
  }
  return null;
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
    this.promptAbortControllers = new Set();

    // Registros de resolución 3-niveles (task / parentID / root) + mapa v2 sessionID -> agent
    this.idleDebounceMs = IDLE_DEBOUNCE_MS;
    this.sessionsById = new Map();
    this.activeSessionId = null;
    this.sessionAgentMap = new Map();
    this.busySessions = new Map();
    this.sessionIdleTimers = new Map();
    this.taskCallsByChildSession = new Map();
    this.taskCallsByPartId = new Map();
    this.activeAgents = new Set();
    this.pendingPermissions = new Map();
    this.liveTaskMeta = new Map(); // externalKey -> { title, file }
    this.capabilities = null;

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

  getSessions() {
    return Array.from(this.sessionsById.values()).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    );
  }

  getPendingPermissions() {
    return Array.from(this.pendingPermissions.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    );
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
      activeSessionId: this.activeSessionId,
      sessions: this.getSessions(),
      pendingPermissions: this.getPendingPermissions(),
      capabilities: this.capabilities,
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

  _extractSessionId(props = {}) {
    return (
      props?.sessionID ||
      props?.sessionId ||
      props?.part?.sessionID ||
      props?.info?.sessionID ||
      props?.info?.id ||
      props?.session?.id ||
      null
    );
  }

  _cancelSessionIdleTimer(sessionId) {
    if (!sessionId) return;
    const existing = this.sessionIdleTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.sessionIdleTimers.delete(sessionId);
    }
  }

  _hasOtherBusySessionForAgent(agentId, excludeSessionId = null) {
    if (!agentId) return false;
    for (const [sid, busyAgent] of this.busySessions.entries()) {
      if (sid !== excludeSessionId && busyAgent === agentId) {
        return true;
      }
    }
    return false;
  }

  _emitLiveKanbanSync({
    sessionId = null,
    agentId = "architect",
    status = "in_progress",
    title = "",
    file = null,
    preserveTitle = false,
  } = {}) {
    if (!agentId) return;
    const sid = sessionId || this.activeSessionId || "global";
    const externalKey = `opencode:${sid}:${agentId}`;
    const prevMeta = this.liveTaskMeta.get(externalKey) || {};

    const resolvedTitle =
      preserveTitle && prevMeta.title
        ? prevMeta.title
        : title || prevMeta.title || "Ejecutando en OpenCode";
    const resolvedFile = file || prevMeta.file || null;

    if (!preserveTitle && title) {
      this.liveTaskMeta.set(externalKey, {
        title: resolvedTitle,
        file: resolvedFile,
      });
    } else if (resolvedFile && !prevMeta.file) {
      this.liveTaskMeta.set(externalKey, {
        title: resolvedTitle,
        file: resolvedFile,
      });
    }

    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_TASK_SYNC,
      {
        externalKey,
        sessionId: sid,
        assigneeId: agentId,
        status,
        title: resolvedTitle,
        file: resolvedFile,
        source: "opencode",
      },
      "opencode-sse",
    );
  }

  _emitPermissionsState(added = false, item = null) {
    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_PERMISSION,
      {
        queue: this.getPendingPermissions(),
        added,
        item,
      },
      "opencode-sse",
    );
    this._emitConnectionState();
  }

  _addPendingPermission(rawPerm, sessionIdHint = null) {
    if (!rawPerm || typeof rawPerm !== "object") return null;
    const id =
      rawPerm.id ||
      rawPerm.requestID ||
      rawPerm.permissionID ||
      rawPerm.callID ||
      null;
    if (!id) return null;

    const sessionID =
      rawPerm.sessionID ||
      rawPerm.sessionId ||
      sessionIdHint ||
      this.activeSessionId ||
      null;
    const toolName = String(
      rawPerm.permission || rawPerm.tool || rawPerm.name || "tool",
    ).toLowerCase();
    const targetSummary =
      formatToolTarget(rawPerm.input || rawPerm.metadata) ||
      shortFileName(rawPerm.pattern || rawPerm.title) ||
      (Array.isArray(rawPerm.patterns) && rawPerm.patterns[0]
        ? shortFileName(rawPerm.patterns[0])
        : null) ||
      toolName;
    const agentId =
      this._resolveEventAgentId("permission.asked", {
        ...rawPerm,
        sessionID,
      }) || "architect";

    const isNew = !this.pendingPermissions.has(id);
    const item = {
      id,
      sessionID,
      agentId,
      toolName,
      targetSummary,
      title: rawPerm.title || `Permiso ${toolName}`,
      createdAt: rawPerm.createdAt || Date.now(),
    };

    this.pendingPermissions.set(id, item);
    if (sessionID) {
      this._cancelSessionIdleTimer(sessionID);
      this.busySessions.set(sessionID, agentId);
    }

    this._emitLiveKanbanSync({
      sessionId: sessionID,
      agentId,
      status: "blocked",
      title: `Permiso CLI: ${toolName}`,
      file: targetSummary,
    });
    this._emitPermissionsState(isNew, item);
    return item;
  }

  _removePendingPermission(requestId) {
    if (!requestId || !this.pendingPermissions.has(requestId)) return false;
    const removed = this.pendingPermissions.get(requestId);
    this.pendingPermissions.delete(requestId);
    this._emitPermissionsState(false, removed);
    return true;
  }

  _releaseSessionNow(
    sessionId,
    agentId,
    { status = "passed", label = "Tarea finalizada", file = null } = {},
  ) {
    if (sessionId) {
      this._cancelSessionIdleTimer(sessionId);
      this.busySessions.delete(sessionId);
    }
    if (agentId) {
      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status: status === "failed" ? "blocked" : "done",
        title: label,
        file,
        preserveTitle: status !== "failed",
      });
    }
    if (agentId && !this._hasOtherBusySessionForAgent(agentId, sessionId)) {
      this._queueAgentTask(
        agentId,
        { status, label, file },
        { immediate: true },
      );
    }
  }

  _scheduleSessionIdleRelease(
    sessionId,
    agentId,
    { label = "Tarea finalizada", delayMs = this.idleDebounceMs } = {},
  ) {
    if (!sessionId) {
      this._releaseSessionNow(null, agentId, { status: "passed", label });
      return;
    }

    this._cancelSessionIdleTimer(sessionId);
    const waitMs = Math.max(0, Number(delayMs) || 0);
    const timer = setTimeout(() => {
      this.sessionIdleTimers.delete(sessionId);
      this._releaseSessionNow(sessionId, agentId, {
        status: "passed",
        label,
      });
    }, waitMs);
    this.sessionIdleTimers.set(sessionId, timer);
  }

  /**
   * Blindaje 1: Cascada exacta de 3 niveles + mapa sessionID -> agent de API v2.
   */
  _resolveEventAgentId(eventType, props = {}) {
    const part = props.part || props;
    const sessionId = this._extractSessionId(props);
    const callKey = part?.callID || part?.id || props?.id || null;
    const toolName = String(part?.tool || props?.name || "").toLowerCase();

    // Nivel 1: part.agent o argumento subagent_type dentro de tool === "task"
    const partInput = part?.state?.input || part?.input || props?.input || {};
    const partMeta = part?.state?.metadata || part?.metadata || props?.metadata || {};
    const tier1Candidate =
      part?.agent ||
      (toolName === "task"
        ? partInput.subagent_type || partInput.agent || partMeta.agent
        : null);

    const tier1Resolved = this.resolveAgentId(tier1Candidate);
    if (tier1Resolved) {
      if (callKey) this.taskCallsByPartId.set(callKey, tier1Resolved);
      if (partMeta.sessionId) {
        this.taskCallsByChildSession.set(partMeta.sessionId, tier1Resolved);
        this.sessionAgentMap.set(partMeta.sessionId, tier1Resolved);
      }
      if (sessionId && part?.agent && toolName !== "task") {
        this.sessionAgentMap.set(sessionId, part.agent);
      }
      return tier1Resolved;
    }

    // Si pertenece a un callID previo de tool="task"
    const knownPartAgent = callKey ? this.taskCallsByPartId.get(callKey) || null : null;
    if (knownPartAgent) return knownPartAgent;

    // Evento explícito directo (session.step.started / webhook /office-event / testing)
    const explicitHint = props.agentId || props.agent;
    const directAgent = this.resolveAgentId(explicitHint);
    if (directAgent) {
      if (sessionId && explicitHint) {
        this.sessionAgentMap.set(sessionId, explicitHint);
      }
      return directAgent;
    }

    // Mapa directo sessionID -> agent de OpenCode API v2 (session.step.started)
    if (sessionId) {
      const mappedHint = this.sessionAgentMap.get(sessionId);
      const mappedAgent = this.resolveAgentId(mappedHint);
      if (mappedAgent) return mappedAgent;

      const childTaskAgent = this.taskCallsByChildSession.get(sessionId);
      if (childTaskAgent) return childTaskAgent;

      // Nivel 2: Metadatos de sesión hija si tiene parentID
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
    const updatedAt =
      sessionObj.time?.updated ||
      sessionObj.updatedAt ||
      prev.updatedAt ||
      Date.now();

    this.sessionsById.set(sessionObj.id, {
      id: sessionObj.id,
      parentID,
      agent: agentHint,
      title,
      updatedAt,
    });

    if (!this.activeSessionId && !parentID) {
      this.activeSessionId = sessionObj.id;
    }

    if (agentHint) {
      this.sessionAgentMap.set(sessionObj.id, agentHint);
    }

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
   * Normaliza cualquier frame SSE proveniente de OpenCode `/api/event` (v2 `data` y clásico `properties`)
   * o del puente `/office-event`.
   */
  ingestEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") return null;

    // Algunos proxies/endpoints globales envuelven { directory, payload: { type, data | properties } }
    const evt =
      rawEvent.payload && rawEvent.payload.type ? rawEvent.payload : rawEvent;

    const eventType = evt.type || "unknown";
    const props = evt.data || evt.properties || evt;
    const sessionId = this._extractSessionId(props);

    this.eventsReceived += 1;
    this.lastEventAt = Date.now();

    if (eventType === "server.connected" || eventType === "server.heartbeat") {
      return null;
    }

    // --- OpenCode API v2: Flujo session.step.* / session.tool.* / session.*.delta ---
    if (eventType === "session.step.started") {
      if (sessionId) {
        this._cancelSessionIdleTimer(sessionId);
        if (!this.activeSessionId) this.activeSessionId = sessionId;
        if (props.agent) {
          this.sessionAgentMap.set(sessionId, props.agent);
          this._upsertSessionRecord({
            id: sessionId,
            agent: props.agent,
            updatedAt: Date.now(),
          });
        }
      }

      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (sessionId) {
        this.busySessions.set(sessionId, agentId);
      }
      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status: "in_progress",
        title: "Paso OpenCode activo",
        preserveTitle: true,
      });
      this._queueAgentTask(agentId, {
        status: "started",
        label: "Paso OpenCode activo",
        file: null,
      });
      return agentId;
    }

    if (
      eventType === "session.tool.input.started" ||
      eventType === "session.tool.called" ||
      eventType === "session.tool.progress" ||
      eventType === "session.tool.success" ||
      eventType === "session.tool.completed" ||
      eventType === "session.tool.error" ||
      eventType === "session.tool.failed"
    ) {
      if (sessionId) {
        this._cancelSessionIdleTimer(sessionId);
      }

      const rawName = props.name || props.tool || "tool";
      const toolName = String(rawName).toLowerCase();
      const input = props.input || props.args || {};
      const file = formatToolTarget(input);

      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (toolName === "task") {
        const parentAgent =
          this.resolveAgentId(this.sessionAgentMap.get(sessionId)) ||
          this.resolveAgentId(this.sessionsById.get(sessionId)?.agent) ||
          "architect";
        if (parentAgent && sessionId) {
          this.busySessions.set(sessionId, parentAgent);
        }
        if (parentAgent && parentAgent !== agentId) {
          const coordLabel = `Coordinando @${agentId}`;
          this._emitLiveKanbanSync({
            sessionId,
            agentId: parentAgent,
            status: "in_progress",
            title: coordLabel,
            file,
          });
          this._queueAgentTask(parentAgent, {
            status: "started",
            label: coordLabel,
            file,
          });
        }
      } else if (sessionId) {
        this.busySessions.set(sessionId, agentId);
      }

      // Preguntas / formularios interactivos (`question`) requieren respuesta en CLI
      if (toolName === "question") {
        const isFinished =
          eventType === "session.tool.success" ||
          eventType === "session.tool.completed";
        if (!isFinished) {
          this._emitLiveKanbanSync({
            sessionId,
            agentId,
            status: "blocked",
            title: "Esperando respuesta en CLI",
            file: file || "question",
          });
          this._queueAgentTask(
            agentId,
            {
              status: "failed",
              label: "Esperando respuesta en CLI",
              file: file || "question",
            },
            { immediate: true },
          );
          return agentId;
        }
      }

      if (
        eventType === "session.tool.error" ||
        eventType === "session.tool.failed"
      ) {
        const errLabel = `Fallo en ${toolName}`;
        this._emitLiveKanbanSync({
          sessionId,
          agentId,
          status: "blocked",
          title: errLabel,
          file,
        });
        this._queueAgentTask(
          agentId,
          {
            status: "failed",
            label: errLabel,
            file,
          },
          { immediate: true },
        );
        return agentId;
      }

      const baseLabel = TOOL_LABELS_ES[toolName] || `Tool: ${toolName}`;
      const label =
        eventType === "session.tool.success" || eventType === "session.tool.completed"
          ? `${baseLabel} ✓`
          : baseLabel;

      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status: "in_progress",
        title: baseLabel,
        file,
      });
      this._queueAgentTask(agentId, {
        status: "started",
        label,
        file,
      });
      return agentId;
    }

    if (eventType.startsWith("session.form.") || eventType === "question.asked") {
      if (sessionId) this._cancelSessionIdleTimer(sessionId);
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      const resolvedForm =
        eventType.endsWith("replied") ||
        eventType.endsWith("submitted") ||
        eventType.endsWith("completed") ||
        eventType.endsWith("ended");

      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status: resolvedForm ? "in_progress" : "blocked",
        title: resolvedForm ? "Formulario respondido" : "Esperando respuesta en CLI",
        file: formatToolTarget(props.input || props) || "form",
      });
      this._queueAgentTask(
        agentId,
        {
          status: resolvedForm ? "started" : "failed",
          label: resolvedForm ? "Continuando tarea" : "Esperando respuesta en CLI",
          file: null,
        },
        { immediate: !resolvedForm },
      );
      return agentId;
    }

    if (
      eventType === "session.text.delta" ||
      eventType === "session.reasoning.delta"
    ) {
      if (sessionId) {
        this._cancelSessionIdleTimer(sessionId);
      }
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (sessionId) {
        this.busySessions.set(sessionId, agentId);
      }
      const label =
        eventType === "session.reasoning.delta"
          ? "Analizando solución"
          : "Redactando respuesta";
      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status: "in_progress",
        title: label,
        preserveTitle: true,
      });
      this._queueAgentTask(agentId, {
        status: "started",
        label,
        file: null,
      });
      return agentId;
    }

    if (eventType === "session.step.ended") {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      const finish = String(props.finish || props.reason || "").toLowerCase();
      if (finish === "tool-calls") {
        // El agente sigue trabajando en el siguiente ciclo de herramientas
        if (sessionId) {
          this._cancelSessionIdleTimer(sessionId);
          this.busySessions.set(sessionId, agentId);
        }
        if (!this.activeAgents.has(agentId)) {
          this._queueAgentTask(agentId, {
            status: "started",
            label: "Ejecutando herramientas",
            file: null,
          });
        }
        return agentId;
      }

      // Liberar a idle tras debounce de ~3s si no llegan nuevos eventos en este sessionID
      this._scheduleSessionIdleRelease(sessionId, agentId, {
        label: "Tarea finalizada",
      });
      return agentId;
    }

    // --- Eventos clásicos / compartidos (session.*, message.*, permission.*) ---
    if (eventType === "session.created" || eventType === "session.updated") {
      const info = props.info || props.session || props;
      this._upsertSessionRecord(info);
      if (info?.id && !info.parentID) {
        this.activeSessionId = info.id;
      }
      const resolved = this._resolveEventAgentId(eventType, {
        ...props,
        info,
      });
      if (resolved && info?.status?.type === "busy") {
        const sid = info.id || sessionId;
        if (sid) {
          this._cancelSessionIdleTimer(sid);
          this.busySessions.set(sid, resolved);
        }
        const label = info.title ? info.title.slice(0, 32) : "Sesión OpenCode activa";
        this._emitLiveKanbanSync({
          sessionId: sid,
          agentId: resolved,
          status: "in_progress",
          title: label,
        });
        this._queueAgentTask(resolved, {
          status: "started",
          label,
          file: null,
        });
      }
      this._emitConnectionState();
      return resolved;
    }

    if (eventType === "session.status") {
      const statusType = props.status?.type || props.status;
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (statusType === "busy" || statusType === "running") {
        if (sessionId) {
          this._cancelSessionIdleTimer(sessionId);
          this.busySessions.set(sessionId, agentId);
        }
        this._emitLiveKanbanSync({
          sessionId,
          agentId,
          status: "in_progress",
          title: "Procesando prompt OpenCode",
          preserveTitle: true,
        });
        this._queueAgentTask(agentId, {
          status: "started",
          label: "Procesando prompt OpenCode",
          file: null,
        });
      } else if (statusType === "idle") {
        this._releaseSessionNow(sessionId, agentId, {
          status: "passed",
          label: "Sesión completada",
        });
      }
      return agentId;
    }

    if (eventType === "session.idle") {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      this._releaseSessionNow(sessionId, agentId, {
        status: "passed",
        label: "Tarea finalizada",
      });
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
      this._releaseSessionNow(sessionId, agentId, {
        status: "failed",
        label: String(errMsg).slice(0, 34),
      });
      return agentId;
    }

    if (
      eventType === "permission.updated" ||
      eventType === "permission.asked" ||
      eventType === "session.permission.asked" ||
      eventType === "session.permission.updated"
    ) {
      if (sessionId) this._cancelSessionIdleTimer(sessionId);
      const item = this._addPendingPermission(props, sessionId);
      const agentId = item?.agentId || this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      this._queueAgentTask(
        agentId,
        {
          status: "failed",
          label: "Esperando permiso CLI",
          file: item?.targetSummary || formatToolTarget(props.input || props),
        },
        { immediate: true },
      );
      return agentId;
    }

    if (
      eventType === "permission.replied" ||
      eventType === "permission.resolved" ||
      eventType === "session.permission.replied"
    ) {
      const reqId = props.requestID || props.permissionID || props.id;
      const existing = reqId ? this.pendingPermissions.get(reqId) : null;
      this._removePendingPermission(reqId);
      const agentId =
        existing?.agentId || this._resolveEventAgentId(eventType, props);
      const replyVal = String(props.reply || props.response || "").toLowerCase();
      if (agentId) {
        const rejected = replyVal === "reject";
        this._emitLiveKanbanSync({
          sessionId: existing?.sessionID || sessionId,
          agentId,
          status: rejected ? "blocked" : "in_progress",
          title: rejected ? "Permiso rechazado" : "Permiso aprobado",
        });
        this._queueAgentTask(agentId, {
          status: rejected ? "failed" : "started",
          label: rejected ? "Permiso rechazado" : "Permiso aprobado",
          file: existing?.targetSummary || null,
        });
      }
      return agentId;
    }

    if (eventType === "message.updated") {
      const info = props.info || props;
      if (info?.sessionID && info?.agent) {
        this._upsertSessionRecord({ id: info.sessionID, agent: info.agent });
      }
      return this._resolveEventAgentId(eventType, props);
    }

    if (eventType === "message.part.updated") {
      if (sessionId) this._cancelSessionIdleTimer(sessionId);
      const part = props.part || props;
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      if (part.type === "tool") {
        const toolName = String(part.tool || "tool").toLowerCase();
        const stateStatus = part.state?.status || "running";
        const input = part.state?.input || part.input || {};
        const file = formatToolTarget(input);

        // Si tool="task" delega a un subagente, también notificar al agente primario
        if (toolName === "task") {
          const parentAgent =
            this.resolveAgentId(
              this.sessionAgentMap.get(part.sessionID) ||
                this.sessionsById.get(part.sessionID)?.agent,
            ) || "architect";
          if (parentAgent && parentAgent !== agentId) {
            const coordLabel = `Coordinando @${agentId}`;
            this._emitLiveKanbanSync({
              sessionId: part.sessionID,
              agentId: parentAgent,
              status: "in_progress",
              title: coordLabel,
              file,
            });
            this._queueAgentTask(parentAgent, {
              status: "started",
              label: coordLabel,
              file,
            });
          }
        } else if (sessionId) {
          this.busySessions.set(sessionId, agentId);
        }

        if (toolName === "question" && stateStatus !== "completed") {
          this._emitLiveKanbanSync({
            sessionId,
            agentId,
            status: "blocked",
            title: "Esperando respuesta en CLI",
            file: file || "question",
          });
          this._queueAgentTask(
            agentId,
            {
              status: "failed",
              label: "Esperando respuesta en CLI",
              file: file || "question",
            },
            { immediate: true },
          );
          return agentId;
        }

        if (stateStatus === "error") {
          this._emitLiveKanbanSync({
            sessionId,
            agentId,
            status: "blocked",
            title: `Fallo en ${toolName}`,
            file,
          });
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
          this._emitLiveKanbanSync({
            sessionId,
            agentId,
            status: "done",
            title: "Subtarea completada",
            file,
          });
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
          this._emitLiveKanbanSync({
            sessionId,
            agentId,
            status: "in_progress",
            title: label,
            file,
          });
          this._queueAgentTask(agentId, {
            status: "started",
            label,
            file,
          });
        }
        return agentId;
      }

      if (part.type === "text" || part.type === "reasoning") {
        if (sessionId) this.busySessions.set(sessionId, agentId);
        const label =
          part.type === "reasoning"
            ? "Analizando solución"
            : "Redactando respuesta";
        this._emitLiveKanbanSync({
          sessionId,
          agentId,
          status: "in_progress",
          title: label,
          preserveTitle: true,
        });
        this._queueAgentTask(agentId, {
          status: "started",
          label,
          file: null,
        });
      }
      return agentId;
    }

    // Webhook personalizado vía puente local (/office-event)
    if (eventType === "office.agent_event" || props.agentId) {
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;
      const status = props.status || "started";
      const file = shortFileName(props.file);
      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status:
          status === "passed"
            ? "done"
            : status === "failed"
              ? "blocked"
              : "in_progress",
        title: props.label || "Evento OpenCode",
        file,
      });
      this._queueAgentTask(
        agentId,
        {
          status,
          label: props.label || "Evento OpenCode",
          file,
        },
        { immediate: status === "passed" || status === "failed" },
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
    for (const idleTimer of this.sessionIdleTimers.values()) {
      clearTimeout(idleTimer);
    }
    this.sessionIdleTimers.clear();
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

  _normalizeDiscoveredPath(rawPath) {
    if (!rawPath) return null;
    if (rawPath.startsWith("/api/") || rawPath === "/api") return rawPath;
    return `${this.apiPrefix}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;
  }

  _fillEndpointTemplate(template, params = {}) {
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
      const lower = key.toLowerCase();
      if (lower.includes("session") || lower === "id") {
        return encodeURIComponent(params.sessionID || "");
      }
      if (lower.includes("request") || lower.includes("permission")) {
        return encodeURIComponent(params.requestID || "");
      }
      if (lower.includes("form")) {
        return encodeURIComponent(params.formID || "");
      }
      return encodeURIComponent(params[key] || "");
    });
  }

  async _discoverOpenApiCapabilities(baseUrl = this.getActiveBaseUrl(), signal) {
    const defaults = {
      discoveredFrom: "defaults",
      promptPaths: [
        `${this.apiPrefix}/session/{sessionID}/prompt`,
        `${this.apiPrefix}/session/{sessionID}/prompt_async`,
        `${this.apiPrefix}/session/{sessionID}/message`,
      ],
      interruptPaths: [
        `${this.apiPrefix}/session/{sessionID}/interrupt`,
        `${this.apiPrefix}/session/{sessionID}/abort`,
      ],
      permissionListPaths: [
        `${this.apiPrefix}/session/{sessionID}/permission`,
        `${this.apiPrefix}/permission`,
      ],
      permissionReplyPaths: [
        `${this.apiPrefix}/session/{sessionID}/permission/{requestID}/reply`,
        `${this.apiPrefix}/permission/{requestID}/reply`,
        `${this.apiPrefix}/session/{sessionID}/permissions/{requestID}`,
      ],
      formListPaths: [`${this.apiPrefix}/session/{sessionID}/form`],
    };

    try {
      const resp = await fetch(`${baseUrl}/openapi.json`, {
        headers: {
          Accept: "application/json",
          ...this._buildAuthHeaders(),
        },
        signal: signal || AbortSignal.timeout(3000),
      });
      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      if (!resp.ok || !ct.includes("application/json")) {
        this.capabilities = defaults;
        return defaults;
      }

      const spec = await resp.json().catch(() => null);
      const paths = spec?.paths;
      if (!paths || typeof paths !== "object") {
        this.capabilities = defaults;
        return defaults;
      }

      const promptFound = [];
      const interruptFound = [];
      const permListFound = [];
      const permReplyFound = [];
      const formListFound = [];

      for (const [rawPath, methods] of Object.entries(paths)) {
        if (!methods || typeof methods !== "object") continue;
        const norm = this._normalizeDiscoveredPath(rawPath);
        if (methods.post) {
          if (/\/session\/\{[^}]+\}\/(prompt|prompt_async|message)$/i.test(rawPath)) {
            promptFound.push(norm);
          } else if (/\/session\/\{[^}]+\}\/(interrupt|abort)$/i.test(rawPath)) {
            interruptFound.push(norm);
          } else if (
            /\/permission\/\{[^}]+\}\/reply$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/permissions\/\{[^}]+\}$/i.test(rawPath)
          ) {
            permReplyFound.push(norm);
          }
        }
        if (methods.get) {
          if (/\/permission$/i.test(rawPath)) {
            permListFound.push(norm);
          } else if (/\/session\/\{[^}]+\}\/form$/i.test(rawPath)) {
            formListFound.push(norm);
          }
        }
      }

      const dedup = (arr, fallback) => [...new Set([...arr, ...fallback])];
      promptFound.sort((a, b) => {
        const rank = (p) =>
          p.endsWith("/prompt") ? 0 : p.endsWith("/prompt_async") ? 1 : 2;
        return rank(a) - rank(b);
      });
      interruptFound.sort((a, b) =>
        a.endsWith("/interrupt") === b.endsWith("/interrupt")
          ? 0
          : a.endsWith("/interrupt")
            ? -1
            : 1,
      );
      permReplyFound.sort((a, b) =>
        a.includes("/session/") === b.includes("/session/")
          ? 0
          : a.includes("/session/")
            ? -1
            : 1,
      );
      permListFound.sort((a, b) =>
        a.includes("/session/") === b.includes("/session/")
          ? 0
          : a.includes("/session/")
            ? -1
            : 1,
      );

      this.capabilities = {
        discoveredFrom: "openapi.json",
        promptPaths: dedup(promptFound, defaults.promptPaths),
        interruptPaths: dedup(interruptFound, defaults.interruptPaths),
        permissionListPaths: dedup(permListFound, defaults.permissionListPaths),
        permissionReplyPaths: dedup(permReplyFound, defaults.permissionReplyPaths),
        formListPaths: dedup(formListFound, defaults.formListPaths),
      };
      return this.capabilities;
    } catch {
      this.capabilities = defaults;
      return defaults;
    }
  }

  async syncSessionPermissions(sessionId = this.activeSessionId, signal) {
    if (!sessionId) return [];
    const baseUrl = this.getActiveBaseUrl();
    const caps = this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl, signal));
    const headers = {
      Accept: "application/json",
      ...this._buildAuthHeaders(),
    };

    for (const template of caps.permissionListPaths) {
      const path = this._fillEndpointTemplate(template, { sessionID: sessionId });
      try {
        const resp = await fetch(`${baseUrl}${path}`, {
          headers,
          signal: signal || AbortSignal.timeout(3000),
        });
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (!resp.ok || !ct.includes("application/json")) continue;

        const data = await resp.json().catch(() => null);
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.permissions)
            ? data.permissions
            : data && typeof data === "object" && data.id
              ? [data]
              : [];

        for (const perm of list) {
          this._addPendingPermission(perm, sessionId);
        }
        return this.getPendingPermissions();
      } catch {
        // Probar siguiente ruta candidata
      }
    }
    return this.getPendingPermissions();
  }

  async createSession({ title = "", agent = "architect" } = {}) {
    const baseUrl = this.getActiveBaseUrl();
    const body = {};
    if (title && String(title).trim()) body.title = String(title).trim().slice(0, 64);
    if (agent) body.agent = agent;

    const resp = await fetch(`${baseUrl}${this.apiPrefix}/session`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...this._buildAuthHeaders(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    });

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!resp.ok) {
      throw new Error(
        resp.status === 401
          ? "Autenticación requerida (401)"
          : `Error HTTP ${resp.status} creando sesión`,
      );
    }
    if (!ct.includes("application/json")) {
      throw new Error("OpenCode devolvió HTML en lugar de JSON al crear sesión");
    }

    const session = await resp.json();
    if (session?.id) {
      this._upsertSessionRecord({ ...session, agent: session.agent || agent });
      this.activeSessionId = session.id;
      this._emitConnectionState();
    }
    return session;
  }

  async sendPrompt({ sessionId = null, agent = "architect", text = "" } = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) {
      return { ok: false, error: "Escribe una instrucción antes de enviar." };
    }

    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));

    let targetSessionId = sessionId || this.activeSessionId;
    if (!targetSessionId) {
      const created = await this.createSession({
        title: cleanText.slice(0, 36),
        agent,
      });
      targetSessionId = created?.id;
    }

    if (!targetSessionId) {
      return { ok: false, error: "No se pudo obtener una sesión activa." };
    }

    this.activeSessionId = targetSessionId;
    if (agent) {
      this.sessionAgentMap.set(targetSessionId, agent);
      this._upsertSessionRecord({
        id: targetSessionId,
        agent,
        updatedAt: Date.now(),
      });
    }

    const body = {
      ...(agent ? { agent } : {}),
      parts: [{ type: "text", text: cleanText }],
    };

    const controller = new AbortController();
    this.promptAbortControllers.add(controller);

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this._buildAuthHeaders(),
    };

    try {
      for (const template of caps.promptPaths) {
        const path = this._fillEndpointTemplate(template, {
          sessionID: targetSessionId,
        });

        const fetchPromise = fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        // Si el endpoint /prompt mantiene la petición abierta durante el turno,
        // no bloqueamos la UI: esperamos hasta 1500ms por errores tempranos (404/401/400)
        // o respuesta inmediata, y si sigue abierto confirmamos el envío en curso.
        const raceOutcome = await Promise.race([
          fetchPromise
            .then((resp) => ({ settled: true, resp }))
            .catch((err) => ({ settled: true, err })),
          new Promise((resolve) =>
            setTimeout(() => resolve({ settled: false }), 1500),
          ),
        ]);

        if (!raceOutcome.settled) {
          this.busySessions.set(targetSessionId, agent || "architect");
          this._emitLiveKanbanSync({
            sessionId: targetSessionId,
            agentId: this.resolveAgentId(agent) || "architect",
            status: "in_progress",
            title: cleanText.slice(0, 48),
          });
          this._queueAgentTask(this.resolveAgentId(agent) || "architect", {
            status: "started",
            label: "Procesando prompt",
            file: null,
          });
          fetchPromise
            .catch((lateErr) => {
              if (lateErr?.name !== "AbortError") {
                this.lastError = lateErr?.message || "Error en prompt OpenCode";
                this._emitConnectionState();
              }
            })
            .finally(() => {
              this.promptAbortControllers.delete(controller);
            });
          return {
            ok: true,
            pending: true,
            sessionId: targetSessionId,
            endpoint: path,
          };
        }

        if (raceOutcome.err) {
          if (raceOutcome.err?.name === "AbortError") {
            return { ok: false, aborted: true, error: "Envío cancelado" };
          }
          throw raceOutcome.err;
        }

        const resp = raceOutcome.resp;
        if (resp.status === 404 || resp.status === 405) {
          continue;
        }
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/html")) {
          continue;
        }
        if (!resp.ok) {
          const errJson = await resp.json().catch(() => null);
          return {
            ok: false,
            status: resp.status,
            error:
              errJson?.error ||
              errJson?.message ||
              (resp.status === 401
                ? "Credenciales Basic Auth inválidas (401)"
                : `HTTP ${resp.status} en ${path}`),
          };
        }

        this.busySessions.set(
          targetSessionId,
          this.resolveAgentId(agent) || "architect",
        );
        this._emitLiveKanbanSync({
          sessionId: targetSessionId,
          agentId: this.resolveAgentId(agent) || "architect",
          status: "in_progress",
          title: cleanText.slice(0, 48),
        });
        this._queueAgentTask(this.resolveAgentId(agent) || "architect", {
          status: "started",
          label: "Prompt recibido",
          file: null,
        });
        return { ok: true, sessionId: targetSessionId, endpoint: path };
      }

      return {
        ok: false,
        error: "No se encontró un endpoint compatible (/prompt o /message)",
      };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || "No se pudo enviar el prompt a OpenCode",
      };
    } finally {
      this.promptAbortControllers.delete(controller);
    }
  }

  async interruptSession(sessionId = this.activeSessionId) {
    for (const ctrl of this.promptAbortControllers) {
      ctrl.abort();
    }
    this.promptAbortControllers.clear();

    if (!sessionId) {
      return { ok: false, error: "No hay sesión activa para detener." };
    }

    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this._buildAuthHeaders(),
    };

    for (const template of caps.interruptPaths) {
      const path = this._fillEndpointTemplate(template, {
        sessionID: sessionId,
      });
      try {
        const resp = await fetch(`${baseUrl}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(4000),
        });
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (resp.status === 404 || resp.status === 405 || ct.includes("text/html")) {
          continue;
        }
        if (!resp.ok) {
          return { ok: false, error: `HTTP ${resp.status} al detener sesión` };
        }
        const agentId =
          this.busySessions.get(sessionId) ||
          this.resolveAgentId(this.sessionAgentMap.get(sessionId)) ||
          "architect";
        this._releaseSessionNow(sessionId, agentId, {
          status: "passed",
          label: "Ejecución detenida",
        });
        return { ok: true, endpoint: path };
      } catch (err) {
        if (err?.name === "TimeoutError") {
          return { ok: false, error: "Tiempo de espera agotado al detener" };
        }
      }
    }

    return {
      ok: false,
      error: "No se encontró endpoint /interrupt o /abort en OpenCode",
    };
  }

  async replyPermission(requestId, response = "once") {
    const item = this.pendingPermissions.get(requestId);
    if (!item) {
      return { ok: false, error: "El permiso ya fue resuelto o expiró." };
    }

    const validResp =
      response === "always" || response === "reject" ? response : "once";
    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this._buildAuthHeaders(),
    };

    const bodyCandidates = [{ response: validResp }, { reply: validResp }];

    for (const template of caps.permissionReplyPaths) {
      if (template.includes("{sessionID}") && !item.sessionID) continue;
      const path = this._fillEndpointTemplate(template, {
        sessionID: item.sessionID || "",
        requestID: requestId,
      });

      for (const payload of bodyCandidates) {
        try {
          const resp = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          });
          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          if (resp.status === 404 || resp.status === 405 || ct.includes("text/html")) {
            break;
          }
          if (resp.status === 400 || resp.status === 422) {
            continue;
          }
          if (!resp.ok) {
            return {
              ok: false,
              error: `Error HTTP ${resp.status} al responder permiso`,
            };
          }

          this._removePendingPermission(requestId);
          const rejected = validResp === "reject";
          this._emitLiveKanbanSync({
            sessionId: item.sessionID,
            agentId: item.agentId,
            status: rejected ? "blocked" : "in_progress",
            title: rejected ? "Permiso rechazado" : "Permiso aprobado",
            file: item.targetSummary,
          });
          this._queueAgentTask(
            item.agentId,
            {
              status: rejected ? "failed" : "started",
              label: rejected ? "Permiso rechazado" : "Permiso aprobado",
              file: item.targetSummary,
            },
            { immediate: rejected },
          );
          return { ok: true, endpoint: path };
        } catch (err) {
          return {
            ok: false,
            error: err?.message || "No se pudo responder el permiso",
          };
        }
      }
    }

    return {
      ok: false,
      error: "No se encontró endpoint compatible de permisos (/permission/.../reply)",
    };
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

      await this._discoverOpenApiCapabilities(baseUrl, signal);

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
              this.activeSessionId = this.activeSessionId || sessionId;
              const agentId = this._resolveEventAgentId("session.status", {
                sessionID: sessionId,
                status: st,
              });
              if (agentId) {
                this.busySessions.set(sessionId, agentId);
                this._emitLiveKanbanSync({
                  sessionId,
                  agentId,
                  status: "in_progress",
                  title: "Sesión OpenCode en curso",
                });
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

      const targetSessionForPerms =
        this.activeSessionId || this.getSessions()[0]?.id || null;
      if (targetSessionForPerms) {
        await this.syncSessionPermissions(targetSessionForPerms, signal).catch(
          () => [],
        );
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
    for (const ctrl of this.promptAbortControllers) {
      ctrl.abort();
    }
    this.promptAbortControllers.clear();
    this._clearThrottleQueues();
    this.activeAgents.clear();
    this.sessionsById.clear();
    this.activeSessionId = null;
    this.sessionAgentMap.clear();
    this.busySessions.clear();
    this.pendingPermissions.clear();
    this.liveTaskMeta.clear();
    this.taskCallsByChildSession.clear();
    this.taskCallsByPartId.clear();
    this.status = "disconnected";
    this.lastError = null;
    this._emitPermissionsState(false, null);
  }

  dispose() {
    this.disconnect();
  }
}

export const openCodeBridge = new OpenCodeBridgeClient();
