import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";
import { agentProfileManager } from "../state/officeWorkspace.js";
import { DEFAULT_AGENT_ALIASES } from "./openCodeTemplates.js";

const STORAGE_KEY = "oficina3d:opencode_config:v1";
const DISMISSED_QUESTIONS_STORAGE_KEY = "oficina3d:opencode_dismissed_questions:v1";
const DISMISSED_INQUIRIES_STORAGE_KEY = "oficina3d:opencode_dismissed_inquiries:v1";
const MAX_PERSISTED_DISMISSED_IDS = 250;
const WATCHDOG_SILENCE_MS = 30000;
const WATCHDOG_CHECK_INTERVAL_MS = 5000;
const AGENT_THROTTLE_MS = 250;
const IDLE_DEBOUNCE_MS = 3000;
const MAX_SESSION_LOG_ENTRIES = 200;
const TEAM_AGENT_IDS = ["architect", "frontend", "qa", "backend", "systems"];

function extractCleanInquiryExcerpt(rawText, maxLen = 135) {
  const clean = String(rawText || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>-]{1,3}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

function looksLikeDirectQuestion(rawText) {
  const clean = extractCleanInquiryExcerpt(rawText, 600);
  if (!clean) return false;
  if (/[¿?]/.test(clean)) return true;
  return /\b(prefieres|quieres que|confirmas|te parece|elige|ind[ií]came|dime si|cu[aá]l prefieres|which option|would you like|do you want|please confirm|let me know)\b/i.test(
    clean,
  );
}

function hashTextShort(text) {
  const str = String(text || "");
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeReadLruIds(storageKey) {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(-MAX_PERSISTED_DISMISSED_IDS);
  } catch {
    return [];
  }
}

function safeWriteLruIds(storageKey, idSet) {
  try {
    if (typeof localStorage === "undefined") return;
    const list = Array.from(idSet || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .slice(-MAX_PERSISTED_DISMISSED_IDS);
    localStorage.setItem(storageKey, JSON.stringify(list));
  } catch {
    // Ignorar error de cuota
  }
}

function safeReadConfig() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
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

function safeReadDismissedQuestionIds() {
  return safeReadLruIds(DISMISSED_QUESTIONS_STORAGE_KEY);
}

function safeWriteDismissedQuestionIds(idSet) {
  safeWriteLruIds(DISMISSED_QUESTIONS_STORAGE_KEY, idSet);
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

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWordToken(normalizedText, token) {
  if (!normalizedText || !token) return false;
  const rx = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}([^a-z0-9]|$)`);
  return rx.test(normalizedText);
}

function isDelegationToolName(toolName) {
  return toolName === "task" || toolName === "subagent";
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
    this.pendingQuestions = new Map();
    this.pendingInquiries = new Map();
    this.questionCallIdMap = new Map();
    this.dismissedQuestionIds = new Set(safeReadDismissedQuestionIds());
    this.dismissedInquiryIds = new Set(safeReadLruIds(DISMISSED_INQUIRIES_STORAGE_KEY));
    this.dismissedSignatureExpiresAt = new Map();
    this.agentPreferredSessionMap = new Map();
    this.currentlyViewedThread = { agentId: null, sessionId: null, chatOpen: false };
    this.questionSyncInFlight = new Map();
    this.questionSyncLastAt = new Map();
    this.liveTaskMeta = new Map(); // externalKey -> { title, file }
    this.openapiSpec = null;
    this.capabilities = null;
    this.capabilitiesCache = new Map();
    this.deadGetPaths = new Set();

    // Bitácora por sesión, historial hidratado y enlace padre -> hijas
    this.sessionLogsById = new Map();
    this.sessionHistoryState = new Map();
    this.historyFetchPromises = new Map();
    this.childSessionsByParent = new Map();
    this.messageMetaById = new Map();
    this.reasoningBuffers = new Map();
    this.activeStreamEntryIds = new Map();
    this.emittedDelegations = new Set();

    // Cola de throttling por agente para proteger CanvasTexture de monitores 3D
    this.lastAgentEmitAt = new Map();
    this.pendingAgentBuffer = new Map();
    this.pendingFlushTimers = new Map();

    // Sincronización espacial 3D <-> puente local (:4097) para MCP
    this.lastSpatialSnapshot = null;
    this.spatialPollTimer = null;
    this.spatialBridgeBackoffUntil = 0;
    this.spatialSyncInFlight = false;
    this.spatialPollInFlight = false;
    this.lastWhiteboardSig = "";
    this.spatialUnsub = officeEventBus.on(
      OFFICE_EVENTS.OFFICE_SPATIAL_STATE,
      (snapshot) => {
        this.syncSpatialState(snapshot);
      },
    );
    if (typeof window !== "undefined") {
      this._startSpatialPolling();
    }
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

    if (
      patch.mode ||
      patch.directUrl ||
      patch.bridgeUrl ||
      typeof patch.username === "string" ||
      typeof patch.password === "string"
    ) {
      this.capabilities = null;
      this.capabilitiesCache.clear();
      this.deadGetPaths.clear();
    }

    this._saveConfig();
    this._emitConnectionState();
    return this.getConfig();
  }

  setActiveSession(sessionId = null) {
    const nextSid = sessionId || null;
    if (this.activeSessionId !== nextSid) {
      this._purgePendingQuestions({
        exceptSessionId: nextSid || "__none__",
        reason: "session_switched",
        kanbanLabel: "Sesión cambiada",
        taskLabel: "Sesión cambiada",
      });
    }
    this.activeSessionId = nextSid;
    this._emitConnectionState();
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

  getPendingQuestions() {
    return Array.from(this.pendingQuestions.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    );
  }

  getSessionHistoryState(sessionId = this.activeSessionId) {
    const sid = sessionId || this.activeSessionId;
    if (!sid) {
      return { status: "idle", error: null, lastSyncedAt: null };
    }
    return (
      this.sessionHistoryState.get(sid) || {
        status: "idle",
        error: null,
        lastSyncedAt: null,
      }
    );
  }

  getChildSessionIds(parentSessionId = this.activeSessionId) {
    if (!parentSessionId) return [];
    const set = this.childSessionsByParent.get(parentSessionId);
    return set ? Array.from(set) : [];
  }

  getSessionLog(sessionId = this.activeSessionId) {
    const sid = sessionId || this.activeSessionId;
    if (!sid) return [];
    const list = this.sessionLogsById.get(sid);
    return Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
  }

  clearSessionLog(sessionId = this.activeSessionId) {
    const sid = sessionId || this.activeSessionId;
    if (!sid) return;
    this.sessionLogsById.delete(sid);
    this.sessionHistoryState.set(sid, {
      status: "loaded",
      error: null,
      lastSyncedAt: Date.now(),
    });
    for (const key of Array.from(this.activeStreamEntryIds.keys())) {
      if (key.startsWith(`${sid}:`)) {
        this.activeStreamEntryIds.delete(key);
      }
    }
    for (const key of Array.from(this.reasoningBuffers.keys())) {
      if (key.startsWith(`${sid}:`)) {
        this.reasoningBuffers.delete(key);
      }
    }
    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_SESSION_LOG,
      { sessionId: sid, entries: [], cleared: true },
      "opencode-sse",
    );
    this._emitConnectionState();
  }

  _emitSessionLog(sessionId) {
    if (!sessionId) return;
    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_SESSION_LOG,
      { sessionId, entries: this.getSessionLog(sessionId) },
      "opencode-sse",
    );
  }

  _ensureSessionLogList(sessionId) {
    const sid = sessionId || this.activeSessionId || "global";
    if (!this.sessionLogsById.has(sid)) {
      this.sessionLogsById.set(sid, []);
    }
    return { sid, list: this.sessionLogsById.get(sid) };
  }

  _appendSessionLogEntry(sessionId, entry = {}) {
    const { sid, list } = this._ensureSessionLogList(sessionId);
    const id =
      entry.id ||
      `${entry.kind || "log"}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      id,
      sourceKey: entry.sourceKey || null,
      callKey: entry.callKey || null,
      sessionId: sid,
      kind: entry.kind || "text",
      agentId: entry.agentId || "architect",
      toolName: entry.toolName || null,
      target: entry.target || null,
      isDelegation: Boolean(entry.isDelegation),
      subagentId: entry.subagentId || null,
      childSessionId: entry.childSessionId || null,
      content: String(entry.content || ""),
      status: entry.status || "done",
      timestamp: entry.timestamp || Date.now(),
    };
    list.push(record);
    if (list.length > MAX_SESSION_LOG_ENTRIES) {
      list.splice(0, list.length - MAX_SESSION_LOG_ENTRIES);
    }
    this._emitSessionLog(sid);
    return record;
  }

  _upsertStreamingLogEntry(
    sessionId,
    {
      streamKey,
      sourceKey = null,
      kind = "text",
      agentId = "architect",
      deltaText = "",
      fullText = null,
      status = "running",
      replaceContent = false,
    } = {},
  ) {
    const { sid, list } = this._ensureSessionLogList(sessionId);
    const activeKey = `${sid}:${kind}:${streamKey || "default"}`;
    let entryId = this.activeStreamEntryIds.get(activeKey);
    let existing = entryId ? list.find((item) => item.id === entryId) : null;
    if (!existing && sourceKey) {
      existing = list.find((item) => item.kind === kind && item.sourceKey === sourceKey);
    }

    const hasIncomingText =
      (typeof deltaText === "string" && deltaText.length > 0) ||
      (typeof fullText === "string" && fullText.length > 0);

    if (!existing && !hasIncomingText) {
      return null;
    }

    if (!existing || (existing.status === "done" && status === "running" && hasIncomingText)) {
      entryId = `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      existing = {
        id: entryId,
        sourceKey: sourceKey || (streamKey && streamKey !== "active" ? `${kind}:${streamKey}` : null),
        callKey: null,
        sessionId: sid,
        kind,
        agentId: agentId || "architect",
        toolName: null,
        target: null,
        isDelegation: false,
        subagentId: null,
        childSessionId: null,
        content: "",
        status,
        timestamp: Date.now(),
      };
      list.push(existing);
      if (list.length > MAX_SESSION_LOG_ENTRIES) {
        list.splice(0, list.length - MAX_SESSION_LOG_ENTRIES);
      }
      this.activeStreamEntryIds.set(activeKey, entryId);
    }

    if (agentId) existing.agentId = agentId;
    if (sourceKey && !existing.sourceKey) existing.sourceKey = sourceKey;
    if (replaceContent && typeof fullText === "string") {
      existing.content = fullText;
    } else if (typeof deltaText === "string" && deltaText.length > 0) {
      existing.content += deltaText;
    } else if (typeof fullText === "string" && fullText.length > existing.content.length) {
      existing.content = fullText;
    }
    existing.status = status;
    existing.timestamp = Date.now();

    if (status === "done") {
      this.activeStreamEntryIds.delete(activeKey);
    }

    this._emitSessionLog(sid);
    return existing;
  }

  _upsertToolLogEntry(
    sessionId,
    {
      callKey = null,
      sourceKey = null,
      agentId = "architect",
      toolName = "tool",
      target = null,
      status = "running",
      errorMessage = null,
      isDelegation = false,
      subagentId = null,
      childSessionId = null,
    } = {},
  ) {
    const { sid, list } = this._ensureSessionLogList(sessionId);
    let existing = null;
    if (callKey) {
      existing = list.find(
        (item) => item.kind === "tool" && item.callKey === callKey,
      );
    } else if (sourceKey) {
      existing = list.find(
        (item) => item.kind === "tool" && item.sourceKey === sourceKey,
      );
    } else {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const item = list[i];
        if (
          item.kind === "tool" &&
          item.toolName === toolName &&
          item.status === "running"
        ) {
          existing = item;
          break;
        }
      }
    }

    const resolvedChild =
      childSessionId ||
      existing?.childSessionId ||
      (isDelegation ? this._findUnassignedChildForDelegation(sid, subagentId) : null);

    if (!existing) {
      existing = {
        id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sourceKey: sourceKey || (callKey ? `call:${callKey}` : null),
        callKey,
        sessionId: sid,
        kind: "tool",
        agentId: agentId || "architect",
        toolName,
        target: target || null,
        isDelegation: Boolean(isDelegation),
        subagentId: subagentId || null,
        childSessionId: resolvedChild || null,
        content: errorMessage ? String(errorMessage) : "",
        status,
        timestamp: Date.now(),
      };
      list.push(existing);
      if (list.length > MAX_SESSION_LOG_ENTRIES) {
        list.splice(0, list.length - MAX_SESSION_LOG_ENTRIES);
      }
    } else {
      if (agentId) existing.agentId = agentId;
      if (target) existing.target = target;
      if (sourceKey && !existing.sourceKey) existing.sourceKey = sourceKey;
      if (isDelegation) existing.isDelegation = true;
      if (subagentId) existing.subagentId = subagentId;
      if (resolvedChild) existing.childSessionId = resolvedChild;
      if (errorMessage) existing.content = String(errorMessage);
      existing.status = status;
      existing.timestamp = Date.now();
    }

    this._emitSessionLog(sid);
    return existing;
  }

  _findUnassignedChildForDelegation(parentSessionId, subagentId = null) {
    if (!parentSessionId) return null;
    const childIds = this.getChildSessionIds(parentSessionId);
    if (childIds.length === 0) return null;
    const logList = this.sessionLogsById.get(parentSessionId) || [];
    const alreadyLinked = new Set(
      logList.map((e) => e.childSessionId).filter(Boolean),
    );
    const candidates = childIds.filter((cid) => !alreadyLinked.has(cid));
    if (candidates.length === 0) return null;

    if (subagentId) {
      for (const cid of candidates) {
        const sess = this.sessionsById.get(cid);
        const childAgent =
          this.taskCallsByChildSession.get(cid) ||
          this.resolveAgentId(sess?.agent) ||
          this._inferSubagentFromText(sess?.title || "");
        if (childAgent === subagentId) return cid;
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  _registerChildSession(parentSessionId, childSessionId, { agent = null, title = "" } = {}) {
    if (!parentSessionId || !childSessionId || parentSessionId === childSessionId) {
      return;
    }
    if (!this.childSessionsByParent.has(parentSessionId)) {
      this.childSessionsByParent.set(parentSessionId, new Set());
    }
    this.childSessionsByParent.get(parentSessionId).add(childSessionId);

    if (!this.sessionsById.has(childSessionId)) {
      this.sessionsById.set(childSessionId, {
        id: childSessionId,
        parentID: parentSessionId,
        agent: agent || null,
        title: title || "",
        updatedAt: Date.now(),
      });
    } else {
      const existing = this.sessionsById.get(childSessionId);
      if (!existing.parentID) existing.parentID = parentSessionId;
      if (agent && !existing.agent) existing.agent = agent;
      if (title && !existing.title) existing.title = title;
    }

    const resolvedChildAgent =
      this.taskCallsByChildSession.get(childSessionId) ||
      this.resolveAgentId(agent) ||
      this._inferSubagentFromText(title);
    if (resolvedChildAgent) {
      this.taskCallsByChildSession.set(childSessionId, resolvedChildAgent);
      this.sessionAgentMap.set(childSessionId, resolvedChildAgent);
      this._trackAgentSession(resolvedChildAgent, childSessionId, { forcePreferred: true });
    }

    const parentLogs = this.sessionLogsById.get(parentSessionId);
    if (Array.isArray(parentLogs) && parentLogs.length > 0) {
      const alreadyLinked = parentLogs.some((e) => e.childSessionId === childSessionId);
      if (!alreadyLinked) {
        let targetEntry = null;
        if (resolvedChildAgent) {
          targetEntry = parentLogs.find(
            (e) =>
              e.kind === "tool" &&
              e.isDelegation &&
              !e.childSessionId &&
              e.subagentId === resolvedChildAgent,
          );
        }
        if (!targetEntry) {
          const runningDelegations = parentLogs.filter(
            (e) => e.kind === "tool" && e.isDelegation && !e.childSessionId,
          );
          if (runningDelegations.length === 1) {
            targetEntry = runningDelegations[0];
          }
        }
        if (targetEntry) {
          targetEntry.childSessionId = childSessionId;
          this._emitSessionLog(parentSessionId);
        }
      }
    }
  }

  _emitDelegationEvent({
    sessionId = null,
    hostAgentId = "architect",
    subagentId = null,
    topic = null,
    callKey = null,
  } = {}) {
    if (!hostAgentId || !subagentId || hostAgentId === subagentId) return;
    const dedupKey = callKey
      ? `${sessionId || "global"}:${callKey}`
      : `${sessionId || "global"}:${hostAgentId}:${subagentId}`;
    if (callKey && this.emittedDelegations.has(dedupKey)) return;
    this.emittedDelegations.add(dedupKey);

    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_DELEGATION,
      {
        sessionId: sessionId || this.activeSessionId,
        hostAgentId,
        subagentId,
        topic: topic || `Subtarea @${subagentId}`,
        active: true,
      },
      "opencode-sse",
    );
  }

  _trackAgentSession(agentId, sessionId, { forcePreferred = false } = {}) {
    if (!agentId || !sessionId) return;
    const canonical = this.resolveAgentId(agentId);
    if (!canonical || !TEAM_AGENT_IDS.includes(canonical)) return;
    const prevSid = this.agentPreferredSessionMap.get(canonical);
    if (forcePreferred || !prevSid || !this.sessionsById.has(prevSid)) {
      this.agentPreferredSessionMap.set(canonical, sessionId);
    }
  }

  getPreferredSessionForAgent(agentId) {
    const canonical = this.resolveAgentId(agentId) || agentId;
    if (!canonical) return null;
    const tracked = this.agentPreferredSessionMap.get(canonical);
    if (tracked && this.sessionsById.has(tracked)) {
      return tracked;
    }

    const sessions = this.getSessions();
    const match = sessions.find((s) => {
      const resolved =
        this.taskCallsByChildSession.get(s.id) ||
        this.resolveAgentId(this.sessionAgentMap.get(s.id)) ||
        this.resolveAgentId(s.agent) ||
        this._inferSubagentFromText(s.title);
      if (canonical === "architect") {
        return !s.parentID && (!resolved || resolved === "architect");
      }
      return resolved === canonical;
    });
    if (match?.id) {
      this.agentPreferredSessionMap.set(canonical, match.id);
      return match.id;
    }
    return null;
  }

  getPendingInquiries() {
    return Array.from(this.pendingInquiries.values()).sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
  }

  getAgentThreadsSnapshot() {
    const questions = this.getPendingQuestions();
    const inquiries = this.getPendingInquiries();
    const threads = {};

    for (const agentId of TEAM_AGENT_IDS) {
      const sid = this.getPreferredSessionForAgent(agentId);
      const qCount = questions.filter((q) => q.agentId === agentId).length;
      const inqCount = inquiries.filter((i) => i.agentId === agentId).length;
      const isBusy =
        Boolean(sid && this.busySessions.has(sid)) ||
        Array.from(this.busySessions.values()).includes(agentId);

      threads[agentId] = {
        agentId,
        sessionId: sid,
        isBusy,
        pendingQuestionsCount: qCount,
        pendingInquiriesCount: inqCount,
        hasAttention: qCount + inqCount > 0,
      };
    }
    return threads;
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
      pendingQuestions: this.getPendingQuestions(),
      pendingInquiries: this.getPendingInquiries(),
      agentThreads: this.getAgentThreadsSnapshot(),
      sessionHistoryStates: Object.fromEntries(this.sessionHistoryState.entries()),
      childSessionsByParent: Object.fromEntries(
        Array.from(this.childSessionsByParent.entries()).map(([k, set]) => [
          k,
          Array.from(set),
        ]),
      ),
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
        if (cleanAlias.length >= 2 && hasWordToken(normalized, cleanAlias)) {
          return agentId;
        }
      }
    }

    return null;
  }

  _inferSubagentFromText(rawText) {
    if (!rawText || typeof rawText !== "string") return null;
    const direct = this.resolveAgentId(rawText);
    if (direct) return direct;

    const text = rawText.trim();
    if (
      /\.(tsx|jsx|vue|svelte|css|scss|html)\b/i.test(text) ||
      /\buse[A-Z][A-Za-z0-9]*\.(ts|js|tsx|jsx)\b/.test(text) ||
      /\b(react|component|componentes?|vista|estilos?|webgl|three\.?js|tailwind|hook|hud)\b/i.test(
        text,
      )
    ) {
      return "frontend";
    }
    if (
      /\.(spec|test)\.[tj]sx?\b/i.test(text) ||
      /\b(playwright|vitest|jest|cypress|pruebas?|tests?|auditor[ií]a|qa)\b/i.test(
        text,
      )
    ) {
      return "qa";
    }
    if (
      /\.(cs|csproj|py|go|rs|java|rb|php|sql)\b/i.test(text) ||
      /\b(Program\.cs|Startup\.cs|controller|middleware|endpoint|database|base de datos|migration|backend|servidor)\b/i.test(
        text,
      )
    ) {
      return "backend";
    }
    if (
      /\.(sh|bash|ps1|dockerfile|ya?ml|toml)\b/i.test(text) ||
      /\b(docker|ci\/cd|deploy|script|cli|systemd|nginx|infra)\b/i.test(text)
    ) {
      return "systems";
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

  _emitQuestionsState(added = false, item = null) {
    const queue = this.getPendingQuestions();
    const inquiries = this.getPendingInquiries();
    const entries = [...queue, ...inquiries];
    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_QUESTION,
      {
        entries,
        queue,
        questions: queue,
        inquiries,
        added,
        item,
      },
      "opencode-sse",
    );
    this._emitConnectionState();
  }

  _markInquiryDismissedLru(inquiryId) {
    const clean = String(inquiryId || "").trim();
    if (!clean) return;
    if (this.dismissedInquiryIds.has(clean)) {
      this.dismissedInquiryIds.delete(clean);
    }
    this.dismissedInquiryIds.add(clean);
    while (this.dismissedInquiryIds.size > MAX_PERSISTED_DISMISSED_IDS) {
      const oldest = this.dismissedInquiryIds.values().next().value;
      if (!oldest) break;
      this.dismissedInquiryIds.delete(oldest);
    }
    safeWriteLruIds(DISMISSED_INQUIRIES_STORAGE_KEY, this.dismissedInquiryIds);
  }

  setViewedThread({ agentId = null, sessionId = null, chatOpen = false } = {}) {
    this.currentlyViewedThread = {
      agentId: agentId ? this.resolveAgentId(agentId) || agentId : null,
      sessionId: sessionId || null,
      chatOpen: Boolean(chatOpen),
    };
    if (this.currentlyViewedThread.chatOpen && this.currentlyViewedThread.agentId) {
      this.markAgentThreadViewed(
        this.currentlyViewedThread.agentId,
        this.currentlyViewedThread.sessionId,
      );
    }
  }

  markAgentThreadViewed(agentId, sessionId = null) {
    const canonical = this.resolveAgentId(agentId) || agentId;
    if (!canonical && !sessionId) return 0;
    let removedCount = 0;
    for (const [id, inq] of Array.from(this.pendingInquiries.entries())) {
      const matchesAgent = canonical && inq.agentId === canonical;
      const matchesSession = sessionId && inq.sessionID === sessionId;
      if (matchesAgent || matchesSession) {
        this._markInquiryDismissedLru(id);
        this.pendingInquiries.delete(id);
        removedCount += 1;
      }
    }
    if (removedCount > 0) {
      this._emitQuestionsState(false, null);
    }
    return removedCount;
  }

  dismissInquiry(inquiryId) {
    const clean = String(inquiryId || "").trim();
    if (!clean) return { ok: true, dismissed: false };
    this._markInquiryDismissedLru(clean);
    const existed = this.pendingInquiries.delete(clean);
    if (existed) {
      this._emitQuestionsState(false, null);
    }
    return { ok: true, dismissed: existed };
  }

  _maybeRegisterSpecialistInquiry({
    sessionId = null,
    agentId = null,
    messageId = null,
    text = "",
    onlyIfQuestion = false,
  } = {}) {
    const canonical = this.resolveAgentId(agentId) || agentId;
    if (!canonical || canonical === "architect") return null;
    if (!sessionId || !text) return null;

    const excerpt = extractCleanInquiryExcerpt(text, 140);
    if (!excerpt) return null;

    const isQuestion = looksLikeDirectQuestion(text);
    if (onlyIfQuestion && !isQuestion) return null;

    // Si el usuario ya tiene una pregunta estructurada (question/form) activa en esa sesión, no duplicar aviso libre
    for (const q of this.pendingQuestions.values()) {
      if (q.sessionID === sessionId || q.agentId === canonical) {
        return null;
      }
    }

    const fingerprint = `inq_${sessionId}_${messageId ? String(messageId) : hashTextShort(excerpt)}`;
    if (this.dismissedInquiryIds.has(fingerprint)) return null;

    // Si el usuario ya está mirando exactamente el chat abierto de este agente o sesión, marcar visto sin notificar
    const viewed = this.currentlyViewedThread;
    if (
      viewed.chatOpen &&
      (viewed.agentId === canonical || (viewed.sessionId && viewed.sessionId === sessionId))
    ) {
      this._markInquiryDismissedLru(fingerprint);
      return null;
    }

    if (this.pendingInquiries.has(fingerprint)) {
      return this.pendingInquiries.get(fingerprint);
    }

    const inquiry = {
      id: fingerprint,
      sessionID: sessionId,
      agentId: canonical,
      excerpt,
      fullText: String(text),
      isQuestionText: isQuestion,
      createdAt: Date.now(),
    };
    this.pendingInquiries.set(fingerprint, inquiry);
    this._trackAgentSession(canonical, sessionId, { forcePreferred: true });
    this._emitQuestionsState(true, inquiry);
    return inquiry;
  }

  _parseJsonSafe(val) {
    if (!val) return null;
    if (typeof val === "object") return val;
    if (typeof val !== "string") return null;
    const trimmed = val.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  _extractToolInputPayload(source = {}) {
    if (!source || typeof source !== "object") return {};
    const merged = {};
    const candidates = [
      this._parseJsonSafe(source.raw),
      this._parseJsonSafe(source.state?.raw),
      this._parseJsonSafe(source.arguments),
      this._parseJsonSafe(source.state?.arguments),
      this._parseJsonSafe(source.params),
      this._parseJsonSafe(source.args),
      this._parseJsonSafe(source.state?.args),
      this._parseJsonSafe(source.input),
      this._parseJsonSafe(source.state?.input),
    ];
    for (const obj of candidates) {
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        Object.assign(merged, obj);
      }
    }
    if (typeof merged.questions === "string") {
      const parsedQ = this._parseJsonSafe(merged.questions);
      if (Array.isArray(parsedQ)) merged.questions = parsedQ;
    }
    if (typeof merged.options === "string") {
      const parsedO = this._parseJsonSafe(merged.options);
      if (Array.isArray(parsedO)) merged.options = parsedO;
    }
    if (typeof merged.choices === "string") {
      const parsedC = this._parseJsonSafe(merged.choices);
      if (Array.isArray(parsedC)) merged.choices = parsedC;
    }
    return merged;
  }

  _hasRealQuestionContent(questions = []) {
    if (!Array.isArray(questions) || questions.length === 0) return false;
    return questions.some(
      (q) =>
        (q?.options && q.options.length > 0) ||
        (q?.question &&
          q.question !== "El agente necesita tu respuesta para continuar."),
    );
  }

  _markQuestionToolEntryDone(sessionId, callKey = null) {
    if (!sessionId) return;
    const list = this.sessionLogsById.get(sessionId);
    if (!Array.isArray(list) || list.length === 0) return;
    let changed = false;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const entry = list[i];
      if (
        entry?.kind === "tool" &&
        entry.toolName === "question" &&
        entry.status === "running" &&
        (!callKey || !entry.callKey || entry.callKey === callKey)
      ) {
        entry.status = "done";
        entry.timestamp = Date.now();
        changed = true;
        if (callKey && entry.callKey === callKey) break;
      }
    }
    if (changed) {
      this._emitSessionLog(sessionId);
    }
  }

  _collectQuestionIdentifiers(rawOrItem) {
    if (!rawOrItem || typeof rawOrItem !== "object") return [];
    const ids = new Set();
    const candidates = [
      rawOrItem.id,
      rawOrItem.formID,
      rawOrItem.formId,
      rawOrItem.requestID,
      rawOrItem.requestId,
      rawOrItem.questionID,
      rawOrItem.questionId,
      rawOrItem.callID,
      rawOrItem.callId,
      rawOrItem.tool?.callID,
      rawOrItem.tool?.callId,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        const trimmed = c.trim();
        ids.add(trimmed);
        const mapped = this.questionCallIdMap.get(trimmed);
        if (typeof mapped === "string" && mapped.trim()) {
          ids.add(mapped.trim());
        }
      }
    }
    return Array.from(ids);
  }

  _buildQuestionSignature(rawOrItem, sessionIdHint = null) {
    if (!rawOrItem || typeof rawOrItem !== "object") return null;
    const sid =
      rawOrItem.sessionID ||
      rawOrItem.sessionId ||
      sessionIdHint ||
      "";
    const questions = Array.isArray(rawOrItem.questions)
      ? rawOrItem.questions
      : this._normalizeQuestionList(rawOrItem);
    const firstQ = questions?.[0]?.question;
    if (!firstQ || firstQ === "El agente necesita tu respuesta para continuar.") {
      return null;
    }
    return `${sid}::${String(firstQ).trim()}`;
  }

  _isQuestionDismissed(rawOrItem, sessionIdHint = null) {
    if (!rawOrItem) return false;
    if (typeof rawOrItem === "string") {
      return this.dismissedQuestionIds.has(rawOrItem.trim());
    }
    const ids = this._collectQuestionIdentifiers(rawOrItem);
    for (const id of ids) {
      if (this.dismissedQuestionIds.has(id)) return true;
    }
    const sig = this._buildQuestionSignature(rawOrItem, sessionIdHint);
    if (sig && this.dismissedSignatureExpiresAt.has(sig)) {
      const expiresAt = this.dismissedSignatureExpiresAt.get(sig) || 0;
      if (Date.now() <= expiresAt) return true;
      this.dismissedSignatureExpiresAt.delete(sig);
    }
    return false;
  }

  _markQuestionDismissed(rawOrItem, extraIds = [], { ttlSignatureMs = 60000 } = {}) {
    let changed = false;
    const addId = (val) => {
      if (typeof val !== "string") return;
      const trimmed = val.trim();
      if (!trimmed) return;
      if (this.dismissedQuestionIds.has(trimmed)) {
        // Reinsertar al final para mantener orden LRU
        this.dismissedQuestionIds.delete(trimmed);
      } else {
        changed = true;
      }
      this.dismissedQuestionIds.add(trimmed);
    };

    if (typeof rawOrItem === "string") {
      addId(rawOrItem);
    } else if (rawOrItem && typeof rawOrItem === "object") {
      for (const id of this._collectQuestionIdentifiers(rawOrItem)) {
        addId(id);
      }
      if (rawOrItem.rawFormData) {
        for (const id of this._collectQuestionIdentifiers(rawOrItem.rawFormData)) {
          addId(id);
        }
      }
      const sig = this._buildQuestionSignature(rawOrItem);
      if (sig) {
        this.dismissedSignatureExpiresAt.set(sig, Date.now() + ttlSignatureMs);
      }
    }

    for (const extra of extraIds || []) {
      addId(extra);
    }

    while (this.dismissedQuestionIds.size > MAX_PERSISTED_DISMISSED_IDS) {
      const oldest = this.dismissedQuestionIds.values().next().value;
      if (!oldest) break;
      this.dismissedQuestionIds.delete(oldest);
      changed = true;
    }

    if (changed || extraIds.length > 0) {
      safeWriteDismissedQuestionIds(this.dismissedQuestionIds);
    }
  }

  _normalizeQuestionList(raw = {}) {
    const rawObj = this._parseJsonSafe(raw) || raw || {};
    const parsedInput = this._parseJsonSafe(rawObj.input);
    const parsedInfo = this._parseJsonSafe(rawObj.info);
    const parsedData = this._parseJsonSafe(rawObj.data);
    const parsedForm = this._parseJsonSafe(rawObj.form);
    const parsedArgs = this._parseJsonSafe(rawObj.args || rawObj.arguments);

    const pickContainer = (obj) => {
      if (!obj || typeof obj !== "object") return false;
      return (
        Array.isArray(obj.questions) ||
        Array.isArray(obj.fields) ||
        Array.isArray(obj.items) ||
        typeof obj.question === "string" ||
        typeof obj.prompt === "string" ||
        typeof obj.message === "string" ||
        typeof obj.title === "string" ||
        Array.isArray(obj.options) ||
        Array.isArray(obj.choices)
      );
    };

    const unwrapped = pickContainer(parsedInput)
      ? parsedInput
      : pickContainer(parsedInfo)
        ? parsedInfo
        : pickContainer(parsedForm)
          ? parsedForm
          : pickContainer(parsedData)
            ? parsedData
            : pickContainer(parsedArgs)
              ? parsedArgs
              : rawObj;

    const parsedQuestions =
      typeof unwrapped?.questions === "string"
        ? this._parseJsonSafe(unwrapped.questions)
        : unwrapped?.questions;
    const parsedFields =
      typeof unwrapped?.fields === "string"
        ? this._parseJsonSafe(unwrapped.fields)
        : unwrapped?.fields;
    const parsedItems =
      typeof unwrapped?.items === "string"
        ? this._parseJsonSafe(unwrapped.items)
        : unwrapped?.items;

    const sourceList =
      Array.isArray(parsedQuestions) && parsedQuestions.length > 0
        ? parsedQuestions
        : Array.isArray(parsedFields) && parsedFields.length > 0
          ? parsedFields
          : Array.isArray(parsedItems) && parsedItems.length > 0
            ? parsedItems
            : [unwrapped];

    return sourceList.map((q, idx) => {
      const qObj = this._parseJsonSafe(q) || q || {};
      const rawOpts = Array.isArray(qObj?.options)
        ? qObj.options
        : Array.isArray(qObj?.choices)
          ? qObj.choices
          : [];
      const options = rawOpts
        .map((opt) => {
          if (typeof opt === "string") {
            const label = opt.trim();
            return label ? { label, value: label, description: "" } : null;
          }
          if (opt && typeof opt === "object") {
            const label = String(
              opt.label || opt.title || opt.name || opt.text || opt.value || opt.id || "",
            ).trim();
            if (!label) return null;
            const rawValue = opt.value ?? opt.id ?? opt.key ?? label;
            return {
              label,
              value: String(rawValue),
              description: String(opt.description || opt.hint || opt.subtitle || "").trim(),
            };
          }
          return null;
        })
        .filter(Boolean);

      return {
        id: qObj?.id || qObj?.fieldID || qObj?.fieldId || qObj?.key || qObj?.name || null,
        fieldType: qObj?.type || qObj?.kind || null,
        header: String(qObj?.header || qObj?.title || qObj?.name || `Pregunta ${idx + 1}`).trim(),
        question: String(
          qObj?.question ||
            qObj?.prompt ||
            qObj?.label ||
            qObj?.text ||
            qObj?.message ||
            qObj?.description ||
            "El agente necesita tu respuesta para continuar.",
        ).trim(),
        options,
        multiple: Boolean(
          qObj?.multiple || qObj?.multiSelect || qObj?.allowMultiple || qObj?.type === "multiselect",
        ),
        custom: options.length === 0 ? true : qObj?.custom !== false,
      };
    });
  }

  _addPendingQuestion(rawQuestion, sessionIdHint = null) {
    if (!rawQuestion || typeof rawQuestion !== "object") return null;
    if (this._isQuestionDismissed(rawQuestion, sessionIdHint)) return null;

    const callID = rawQuestion.tool?.callID || rawQuestion.callID || rawQuestion.callId || null;
    const formID =
      rawQuestion.formID ||
      rawQuestion.formId ||
      (/^frm_/i.test(String(rawQuestion.id || "")) ? rawQuestion.id : null);
    const requestID =
      rawQuestion.requestID ||
      rawQuestion.requestId ||
      rawQuestion.questionID ||
      rawQuestion.questionId ||
      (/^que_/i.test(String(rawQuestion.id || "")) ? rawQuestion.id : null);
    const realId =
      requestID ||
      formID ||
      (!rawQuestion.isSynthetic ? rawQuestion.id : null) ||
      null;
    const id = realId || rawQuestion.id || callID || null;
    if (!id) return null;

    const isSynthetic = Boolean(
      rawQuestion.isSynthetic || (!realId && callID && id === callID),
    );

    const sessionID =
      rawQuestion.sessionID ||
      rawQuestion.sessionId ||
      sessionIdHint ||
      this.activeSessionId ||
      null;

    let questions = this._normalizeQuestionList(rawQuestion);
    const hasRealContent = this._hasRealQuestionContent(questions);
    const firstPrompt = hasRealContent ? questions[0]?.question || "" : "";

    // No degradar una pregunta real (que_... / formID) ya registrada si vuelve a llegar un evento sintético
    if (isSynthetic) {
      if (callID && this.questionCallIdMap.has(callID)) {
        const mappedId = this.questionCallIdMap.get(callID);
        if (mappedId && mappedId !== id && this.pendingQuestions.has(mappedId)) {
          const existingReal = this.pendingQuestions.get(mappedId);
          if (!this._hasRealQuestionContent(existingReal.questions) && hasRealContent) {
            existingReal.questions = questions;
            existingReal.header = questions[0]?.header || existingReal.header;
            this._emitQuestionsState(false, existingReal);
          }
          return existingReal;
        }
      }
      for (const existing of this.pendingQuestions.values()) {
        if (
          !existing.isSynthetic &&
          existing.sessionID === sessionID &&
          ((callID && existing.callID === callID) ||
            (firstPrompt && existing.questions?.[0]?.question === firstPrompt))
        ) {
          if (callID) this.questionCallIdMap.set(callID, existing.id);
          if (!this._hasRealQuestionContent(existing.questions) && hasRealContent) {
            existing.questions = questions;
            existing.header = questions[0]?.header || existing.header;
            this._emitQuestionsState(false, existing);
          }
          return existing;
        }
      }
    } else {
      // Si existía un placeholder sintético creado desde tool="question", reemplazarlo por el ID real
      const replacedSynthetics = [];
      if (callID) {
        const synthId = this.questionCallIdMap.get(callID) || callID;
        if (synthId !== id && this.pendingQuestions.has(synthId)) {
          replacedSynthetics.push(this.pendingQuestions.get(synthId));
          this.pendingQuestions.delete(synthId);
        }
      }
      for (const [existingId, existing] of this.pendingQuestions.entries()) {
        if (
          existing.isSynthetic &&
          existingId !== id &&
          ((callID && existing.callID === callID) ||
            (existing.sessionID === sessionID &&
              ((firstPrompt && existing.questions?.[0]?.question === firstPrompt) ||
                existing.isPlaceholderOnly)))
        ) {
          replacedSynthetics.push(existing);
          this.pendingQuestions.delete(existingId);
        }
      }
      if (!hasRealContent) {
        const richer = replacedSynthetics.find((s) =>
          this._hasRealQuestionContent(s?.questions),
        );
        if (richer) {
          questions = richer.questions;
        }
      }
    }

    if (callID) {
      this.questionCallIdMap.set(callID, id);
    }

    const firstHeader = questions[0]?.header || "Pregunta";
    const agentId =
      this.resolveAgentId(rawQuestion.agentId || rawQuestion.agent) ||
      this._resolveEventAgentId("question.asked", {
        ...rawQuestion,
        sessionID,
      }) ||
      "architect";

    const isNew = !this.pendingQuestions.has(id);
    const prevItem = this.pendingQuestions.get(id);
    if (prevItem && !hasRealContent && this._hasRealQuestionContent(prevItem.questions)) {
      questions = prevItem.questions;
    }

    const item = {
      id,
      formID: formID || prevItem?.formID || null,
      requestID: requestID || prevItem?.requestID || null,
      callID: callID || prevItem?.callID || null,
      isSynthetic,
      isPlaceholderOnly: !this._hasRealQuestionContent(questions),
      sessionID,
      agentId,
      header: questions[0]?.header || firstHeader,
      questions,
      rawFormData: !isSynthetic ? rawQuestion : prevItem?.rawFormData || rawQuestion,
      createdAt: rawQuestion.createdAt || prevItem?.createdAt || Date.now(),
    };

    if (this._isQuestionDismissed(item, sessionID)) {
      return null;
    }

    this.pendingQuestions.set(id, item);
    if (sessionID) {
      this._cancelSessionIdleTimer(sessionID);
      this.busySessions.set(sessionID, agentId);
    }

    this._emitLiveKanbanSync({
      sessionId: sessionID,
      agentId,
      status: "blocked",
      title: `Pregunta: ${item.header}`,
      file: questions[0]?.question?.slice(0, 40) || "question",
    });
    this._emitQuestionsState(isNew, item);
    return item;
  }

  _removePendingQuestion(requestIdOrCallId) {
    if (!requestIdOrCallId) return null;
    const mappedId = this.questionCallIdMap.get(requestIdOrCallId) || requestIdOrCallId;
    const targetId = this.pendingQuestions.has(requestIdOrCallId)
      ? requestIdOrCallId
      : this.pendingQuestions.has(mappedId)
        ? mappedId
        : null;
    if (!targetId) return null;

    const removed = this.pendingQuestions.get(targetId);
    this.pendingQuestions.delete(targetId);
    if (removed?.callID) {
      this.questionCallIdMap.delete(removed.callID);
    }
    this._emitQuestionsState(false, removed);
    return removed;
  }

  _purgePendingQuestions({
    sessionId = null,
    exceptSessionId = null,
    reason = "cleared",
    kanbanLabel = "Pregunta descartada",
    taskLabel = "Disponible",
    persistDismiss = false,
  } = {}) {
    if (this.pendingQuestions.size === 0) return [];

    const childSet =
      sessionId && this.childSessionsByParent.get(sessionId)
        ? this.childSessionsByParent.get(sessionId)
        : null;
    const exceptChildSet =
      exceptSessionId &&
      exceptSessionId !== "__none__" &&
      this.childSessionsByParent.get(exceptSessionId)
        ? this.childSessionsByParent.get(exceptSessionId)
        : null;

    const removedItems = [];
    for (const [id, item] of Array.from(this.pendingQuestions.entries())) {
      const itemSid = item?.sessionID || null;
      let shouldRemove = false;

      if (exceptSessionId !== null) {
        const keep =
          exceptSessionId !== "__none__" &&
          itemSid &&
          (itemSid === exceptSessionId || exceptChildSet?.has(itemSid));
        shouldRemove = !keep;
      } else if (sessionId) {
        shouldRemove =
          !itemSid || itemSid === sessionId || Boolean(childSet?.has(itemSid));
      } else {
        shouldRemove = true;
      }

      if (!shouldRemove) continue;

      if (persistDismiss) {
        this._markQuestionDismissed(item, [id]);
      }

      this.pendingQuestions.delete(id);
      if (item?.callID) {
        this.questionCallIdMap.delete(item.callID);
      }
      for (const [callKey, mapped] of Array.from(this.questionCallIdMap.entries())) {
        if (mapped === id) {
          this.questionCallIdMap.delete(callKey);
        }
      }
      removedItems.push(item);
    }

    if (removedItems.length === 0) return [];

    const releasedAgents = new Set();
    for (const item of removedItems) {
      if (item.sessionID) {
        this._markQuestionToolEntryDone(item.sessionID, item.callID);
      }
      if (item.agentId && !releasedAgents.has(`${item.sessionID || ""}:${item.agentId}`)) {
        releasedAgents.add(`${item.sessionID || ""}:${item.agentId}`);
        this._releaseSessionNow(item.sessionID, item.agentId, {
          status: "passed",
          label: taskLabel,
          file: item.header || reason,
        });
      }
      this._emitLiveKanbanSync({
        sessionId: item.sessionID,
        agentId: item.agentId,
        status: "done",
        title: kanbanLabel,
        file: item.header || "question",
      });
    }

    if (this.pendingInquiries.size > 0) {
      for (const [inqId, inq] of Array.from(this.pendingInquiries.entries())) {
        const inqSid = inq?.sessionID || null;
        if (
          !sessionId ||
          inqSid === sessionId ||
          Boolean(childSet?.has(inqSid))
        ) {
          this._markInquiryDismissedLru(inqId);
          this.pendingInquiries.delete(inqId);
        }
      }
    }

    this._emitQuestionsState(false, removedItems[removedItems.length - 1]);
    return removedItems;
  }

  dismissQuestion(requestId) {
    const { targetId, item } = this._resolveQuestionTarget(requestId);
    this._markQuestionDismissed(item || requestId, [requestId, targetId]);
    if (!item) {
      return { ok: true, dismissed: false };
    }
    this._removePendingQuestion(targetId);
    this._removePendingQuestion(requestId);
    if (item.sessionID) {
      this._markQuestionToolEntryDone(item.sessionID, item.callID);
    }
    this._releaseSessionNow(item.sessionID, item.agentId, {
      status: "passed",
      label: "Pregunta descartada",
      file: item.header,
    });
    this._emitLiveKanbanSync({
      sessionId: item.sessionID,
      agentId: item.agentId,
      status: "done",
      title: "Pregunta descartada",
      file: item.header,
    });
    return { ok: true, dismissed: true };
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
    if (status === "passed" && sessionId && agentId && agentId !== "architect") {
      const logs = this.sessionLogsById.get(sessionId) || [];
      for (let i = logs.length - 1; i >= 0; i -= 1) {
        const entry = logs[i];
        if (entry?.kind === "text" && entry.content && entry.agentId === agentId) {
          this._maybeRegisterSpecialistInquiry({
            sessionId,
            agentId,
            messageId: entry.sourceKey || entry.id,
            text: entry.content,
            onlyIfQuestion: false,
          });
          break;
        }
      }
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

    // Nivel 1: argumento dentro de herramientas de delegación (task / subagent) o part.agent
    const partInput = part?.state?.input || part?.input || props?.input || {};
    const partMeta = part?.state?.metadata || part?.metadata || props?.metadata || {};
    const isDelegation = isDelegationToolName(toolName);
    const delegationTargetCandidate = isDelegation
      ? partInput.subagent_type ||
        partInput.agent ||
        partInput.target ||
        partInput.delegate ||
        partMeta.agent
      : null;

    const tier1Resolved = isDelegation
      ? this.resolveAgentId(delegationTargetCandidate) ||
        this._inferSubagentFromText(
          partInput.description ||
            partInput.title ||
            partInput.prompt ||
            partInput.task ||
            partMeta.title ||
            "",
        )
      : this.resolveAgentId(part?.agent);

    if (tier1Resolved) {
      if (callKey) this.taskCallsByPartId.set(callKey, tier1Resolved);
      if (partMeta.sessionId) {
        this.taskCallsByChildSession.set(partMeta.sessionId, tier1Resolved);
        this.sessionAgentMap.set(partMeta.sessionId, tier1Resolved);
        this._trackAgentSession(tier1Resolved, partMeta.sessionId, { forcePreferred: true });
      }
      if (sessionId && part?.agent && !isDelegation) {
        this.sessionAgentMap.set(sessionId, part.agent);
      }
      return tier1Resolved;
    }

    if (isDelegation && part?.agent) {
      const fallbackHost = this.resolveAgentId(part.agent);
      if (fallbackHost) return fallbackHost;
    }

    // Si pertenece a un callID previo de tool="task" o "subagent"
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

    if (agentHint) {
      this.sessionAgentMap.set(sessionObj.id, agentHint);
      if (!parentID) {
        this._trackAgentSession(agentHint, sessionObj.id);
      }
    }

    if (parentID) {
      this._registerChildSession(parentID, sessionObj.id, {
        agent: agentHint,
        title,
      });
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

    if (eventType === "office.spatial.command") {
      const command = props?.command && typeof props.command === "object" ? props.command : props;
      const whiteboard = props?.whiteboard;
      if (whiteboard && Array.isArray(whiteboard.notes)) {
        this._syncWhiteboardFromBridge(whiteboard.notes);
      }
      if (command && command.type && (command.agentId || command.agente)) {
        officeEventBus.emit(OFFICE_EVENTS.OFFICE_SPATIAL_COMMAND, command, "opencode-sse");
        return command.agentId || command.agente || null;
      }
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
      const input = this._extractToolInputPayload(props);
      const file = formatToolTarget(input);
      const callKey = props.id || props.callID || props.partID || null;
      const isFinished =
        eventType === "session.tool.success" ||
        eventType === "session.tool.completed";
      const isError =
        eventType === "session.tool.error" ||
        eventType === "session.tool.failed";

      const isDelegation = isDelegationToolName(toolName);
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      let parentAgentForTask = null;
      if (isDelegation) {
        parentAgentForTask =
          this.resolveAgentId(this.sessionAgentMap.get(sessionId)) ||
          this.resolveAgentId(this.sessionsById.get(sessionId)?.agent) ||
          "architect";
        if (parentAgentForTask && sessionId) {
          this.busySessions.set(sessionId, parentAgentForTask);
        }
        if (parentAgentForTask && parentAgentForTask !== agentId) {
          const coordLabel = `Coordinando @${agentId}`;
          const topic = file || input.description || `Subtarea @${agentId}`;
          if (!isError) {
            this._emitDelegationEvent({
              sessionId,
              hostAgentId: parentAgentForTask,
              subagentId: agentId,
              topic,
              callKey,
            });
          }
          this._emitLiveKanbanSync({
            sessionId,
            agentId: parentAgentForTask,
            status: "in_progress",
            title: coordLabel,
            file,
          });
          this._queueAgentTask(parentAgentForTask, {
            status: "started",
            phase: "working",
            label: coordLabel,
            file,
            delegationEvent: !isError,
          });
        }
      } else if (sessionId) {
        this.busySessions.set(sessionId, agentId);
      }

      const logTarget =
        isDelegation && parentAgentForTask && parentAgentForTask !== agentId
          ? `@${agentId}${file ? ` · ${file}` : ""}`
          : file || (typeof input.description === "string" ? input.description.slice(0, 40) : null);

      const metaObj = props.metadata || props.state?.metadata || {};
      const childSessionId =
        metaObj.sessionId || metaObj.sessionID || metaObj.childSessionId || props.childSessionId || null;
      const targetSid = sessionId || this.activeSessionId;

      if (isDelegation && childSessionId && targetSid) {
        this._registerChildSession(targetSid, childSessionId, {
          agent: agentId,
          title: file || input.description || "",
        });
      }

      this._upsertToolLogEntry(targetSid, {
        callKey,
        agentId:
          isDelegation && parentAgentForTask ? parentAgentForTask : agentId,
        toolName,
        target: logTarget,
        status: isError ? "error" : isFinished ? "done" : "running",
        isDelegation,
        subagentId: isDelegation ? agentId : null,
        childSessionId,
        errorMessage: isError
          ? props.error?.data?.message || props.error?.message || props.message || null
          : null,
      });

      // Preguntas / formularios interactivos (`question`) se disparan directo desde la tool en curso
      if (toolName === "question") {
        if (!isFinished && !isError) {
          const provisionalId =
            callKey || `q_${targetSid || "global"}_${props.messageID || "active"}_question`;
          this._addPendingQuestion(
            {
              ...input,
              id: provisionalId,
              callID: callKey || provisionalId,
              isSynthetic: true,
              sessionID: targetSid,
              agentId,
            },
            targetSid,
          );
          this.syncPendingQuestions(targetSid).catch(() => []);
          this._queueAgentTask(
            agentId,
            {
              status: "failed",
              label: "Esperando respuesta",
              file: file || "question",
            },
            { immediate: true },
          );
          return agentId;
        }
        if (isFinished) {
          this._removePendingQuestion(callKey);
        }
      }

      if (isError) {
        if (toolName === "question") {
          this._removePendingQuestion(callKey);
        }
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

      if (isFinished && isDelegation && parentAgentForTask !== agentId) {
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
        return agentId;
      }

      const baseLabel = TOOL_LABELS_ES[toolName] || `Tool: ${toolName}`;
      const label = isFinished ? `${baseLabel} ✓` : baseLabel;

      this._emitLiveKanbanSync({
        sessionId,
        agentId,
        status: "in_progress",
        title: baseLabel,
        file,
      });
      this._queueAgentTask(agentId, {
        status: "started",
        phase: "working",
        label,
        file,
        delegationEvent:
          isDelegation &&
          Boolean(parentAgentForTask && parentAgentForTask !== agentId && !isFinished),
      });
      return agentId;
    }

    if (
      eventType.startsWith("session.form.") ||
      eventType.startsWith("question.") ||
      eventType.startsWith("session.question.")
    ) {
      if (sessionId) this._cancelSessionIdleTimer(sessionId);

      const resolvedForm =
        eventType.endsWith("replied") ||
        eventType.endsWith("rejected") ||
        eventType.endsWith("submitted") ||
        eventType.endsWith("completed") ||
        eventType.endsWith("ended") ||
        eventType.endsWith("resolved");

      if (resolvedForm) {
        const reqId =
          props.requestID ||
          props.questionID ||
          props.formID ||
          props.id ||
          props.callID ||
          props.tool?.callID;
        const removed = this._removePendingQuestion(reqId);
        const agentId =
          removed?.agentId || this._resolveEventAgentId(eventType, props) || "architect";
        const rejected = eventType.endsWith("rejected");

        this._emitLiveKanbanSync({
          sessionId: removed?.sessionID || sessionId,
          agentId,
          status: rejected ? "blocked" : "in_progress",
          title: rejected ? "Pregunta omitida" : "Respuesta enviada",
          file: removed?.header || "question",
        });
        this._queueAgentTask(agentId, {
          status: rejected ? "failed" : "started",
          phase: "working",
          label: rejected ? "Pregunta omitida" : "Continuando tarea",
          file: null,
        });
        return agentId;
      }

      const added = this._addPendingQuestion(props, sessionId);
      const agentId =
        added?.agentId || this._resolveEventAgentId(eventType, props) || "architect";
      this._queueAgentTask(
        agentId,
        {
          status: "failed",
          label: "Esperando respuesta",
          file: added?.header || formatToolTarget(props.input || props) || "question",
        },
        { immediate: true },
      );
      return agentId;
    }

    if (
      eventType === "session.reasoning.started" ||
      eventType === "session.reasoning.delta" ||
      eventType === "session.reasoning.ended"
    ) {
      const sid = sessionId || this.activeSessionId || "global";
      this._cancelSessionIdleTimer(sid);
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      this.busySessions.set(sid, agentId);
      const chunk = String(
        props.delta ?? props.text ?? props.part?.text ?? "",
      );
      const streamId = props.partID || props.part?.id || props.id || props.messageID || "active";
      const sourceKey = props.messageID
        ? `msg:${props.messageID}:part:${streamId}`
        : null;
      const bufferKey = `${sid}:${agentId}`;

      if (eventType === "session.reasoning.started") {
        this.reasoningBuffers.set(bufferKey, chunk);
        this._upsertStreamingLogEntry(sid, {
          streamKey: streamId,
          sourceKey,
          kind: "reasoning",
          agentId,
          fullText: chunk,
          status: "running",
          replaceContent: true,
        });
      } else if (eventType === "session.reasoning.delta") {
        const nextBuf = `${this.reasoningBuffers.get(bufferKey) || ""}${chunk}`.slice(-500);
        this.reasoningBuffers.set(bufferKey, nextBuf);
        this._upsertStreamingLogEntry(sid, {
          streamKey: streamId,
          sourceKey,
          kind: "reasoning",
          agentId,
          deltaText: chunk,
          status: "running",
        });
      } else {
        this._upsertStreamingLogEntry(sid, {
          streamKey: streamId,
          sourceKey,
          kind: "reasoning",
          agentId,
          fullText: chunk || undefined,
          status: "done",
        });
      }

      const excerpt = extractReasoningExcerpt(
        this.reasoningBuffers.get(bufferKey) || chunk,
      );
      const bubbleLabel = excerpt ? `Pensando · ${excerpt}` : "Pensando...";

      this._emitLiveKanbanSync({
        sessionId: sid,
        agentId,
        status: "in_progress",
        title: "Pensando...",
        preserveTitle: true,
      });
      this._queueAgentTask(agentId, {
        status: "started",
        phase: "thinking",
        label: bubbleLabel,
        file: null,
      });
      return agentId;
    }

    if (
      eventType === "session.text.started" ||
      eventType === "session.text.delta" ||
      eventType === "session.text.ended"
    ) {
      const sid = sessionId || this.activeSessionId || "global";
      this._cancelSessionIdleTimer(sid);
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      this.busySessions.set(sid, agentId);
      const chunk = String(
        props.delta ?? props.text ?? props.part?.text ?? "",
      );
      const streamId = props.partID || props.part?.id || props.id || props.messageID || "active";
      const sourceKey = props.messageID
        ? `msg:${props.messageID}:part:${streamId}`
        : null;

      if (eventType === "session.text.started") {
        this._upsertStreamingLogEntry(sid, {
          streamKey: streamId,
          sourceKey,
          kind: "text",
          agentId,
          fullText: chunk,
          status: "running",
          replaceContent: true,
        });
      } else if (eventType === "session.text.delta") {
        this._upsertStreamingLogEntry(sid, {
          streamKey: streamId,
          sourceKey,
          kind: "text",
          agentId,
          deltaText: chunk,
          status: "running",
        });
      } else {
        this._upsertStreamingLogEntry(sid, {
          streamKey: streamId,
          sourceKey,
          kind: "text",
          agentId,
          fullText: chunk || undefined,
          status: "done",
        });
        if (agentId !== "architect") {
          const logs = this.sessionLogsById.get(sid) || [];
          const doneEntry = logs.find(
            (e) =>
              e.kind === "text" &&
              ((sourceKey && e.sourceKey === sourceKey) || e.streamKey === streamId),
          );
          const fullText = doneEntry?.content || chunk;
          if (fullText) {
            this._maybeRegisterSpecialistInquiry({
              sessionId: sid,
              agentId,
              messageId: sourceKey || streamId,
              text: fullText,
              onlyIfQuestion: true,
            });
          }
        }
      }

      this._emitLiveKanbanSync({
        sessionId: sid,
        agentId,
        status: "in_progress",
        title: "Redactando respuesta",
        preserveTitle: true,
      });
      this._queueAgentTask(agentId, {
        status: "started",
        phase: "working",
        label: "Redactando respuesta",
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
      if (
        info?.id &&
        !info.parentID &&
        !this.activeSessionId &&
        (eventType === "session.created" || info?.status?.type === "busy")
      ) {
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
      this._appendSessionLogEntry(sessionId || this.activeSessionId, {
        kind: "error",
        agentId,
        content: String(errMsg),
        status: "error",
      });
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
      if (info?.id) {
        this.messageMetaById.set(info.id, {
          role: info.role || "assistant",
          agent: info.agent || null,
          sessionID: info.sessionID || sessionId || null,
        });
      }
      if (info?.sessionID && info?.agent) {
        this._upsertSessionRecord({ id: info.sessionID, agent: info.agent });
      }
      return this._resolveEventAgentId(eventType, props);
    }

    if (eventType === "message.part.updated") {
      if (sessionId) this._cancelSessionIdleTimer(sessionId);
      const part = props.part || props;
      if (part.synthetic || part.ignored) return null;
      const msgMeta = part.messageID ? this.messageMetaById.get(part.messageID) : null;
      const agentId = this._resolveEventAgentId(eventType, props);
      if (!agentId) return null;

      const partRole = String(msgMeta?.role || part.role || props.info?.role || "").toLowerCase();

      // Evitar duplicar prompts del usuario cuando message.part.updated emite la parte user text
      if (partRole === "user" && part.type === "text") {
        const sid = part.sessionID || sessionId || this.activeSessionId || "global";
        const textVal = String(part.text || "").trim();
        const sourceKey = part.messageID ? `msg:${part.messageID}:part:${part.id || 0}` : null;
        if (textVal) {
          const { list } = this._ensureSessionLogList(sid);
          const already = list.find(
            (e) =>
              e.kind === "prompt" &&
              ((sourceKey && e.sourceKey === sourceKey) ||
                (!e.sourceKey && e.content.trim() === textVal)),
          );
          if (already) {
            if (sourceKey && !already.sourceKey) already.sourceKey = sourceKey;
          } else {
            this._appendSessionLogEntry(sid, {
              sourceKey,
              kind: "prompt",
              agentId: this.resolveAgentId(msgMeta?.agent) || agentId,
              content: textVal,
              status: "done",
              timestamp: part.time?.start || Date.now(),
            });
          }
        }
        return agentId;
      }

      if (part.type === "tool") {
        const toolName = String(part.tool || part.name || "tool").toLowerCase();
        const stateStatus = String(part.state?.status || "running").toLowerCase();
        const input = this._extractToolInputPayload(part);
        const metaObj = part.state?.metadata || part.metadata || {};
        const file = formatToolTarget(input);
        const callKey = part.callID || part.id || props.id || null;
        const isDone = stateStatus === "completed";
        const isErr = stateStatus === "error" || stateStatus === "failed";

        const isDelegation = isDelegationToolName(toolName);
        let parentAgent = null;
        // Si tool="task" o "subagent" delega a un subagente, notificar también al agente primario
        if (isDelegation) {
          parentAgent =
            this.resolveAgentId(
              this.sessionAgentMap.get(part.sessionID) ||
                this.sessionsById.get(part.sessionID)?.agent,
            ) || "architect";
          if (parentAgent && parentAgent !== agentId) {
            const coordLabel = `Coordinando @${agentId}`;
            const topic = file || input.description || `Subtarea @${agentId}`;
            if (!isErr) {
              this._emitDelegationEvent({
                sessionId: part.sessionID || sessionId,
                hostAgentId: parentAgent,
                subagentId: agentId,
                topic,
                callKey,
              });
            }
            this._emitLiveKanbanSync({
              sessionId: part.sessionID,
              agentId: parentAgent,
              status: "in_progress",
              title: coordLabel,
              file,
            });
            this._queueAgentTask(parentAgent, {
              status: "started",
              phase: "working",
              label: coordLabel,
              file,
              delegationEvent: !isErr,
            });
          }
        } else if (sessionId) {
          this.busySessions.set(sessionId, agentId);
        }

        const logTarget =
          isDelegation && parentAgent && parentAgent !== agentId
            ? `@${agentId}${file ? ` · ${file}` : ""}`
            : file || (typeof input.description === "string" ? input.description.slice(0, 40) : null);

        const targetSid = part.sessionID || sessionId || this.activeSessionId;
        const childSessionId =
          metaObj.sessionId || metaObj.sessionID || metaObj.childSessionId || null;
        if (isDelegation && childSessionId && targetSid) {
          this._registerChildSession(targetSid, childSessionId, {
            agent: agentId,
            title: file || input.description || "",
          });
        }

        this._upsertToolLogEntry(targetSid, {
          callKey,
          sourceKey: part.messageID ? `msg:${part.messageID}:part:${part.id || callKey || "tool"}` : null,
          agentId: isDelegation && parentAgent ? parentAgent : agentId,
          toolName,
          target: logTarget,
          isDelegation,
          subagentId: isDelegation ? agentId : null,
          childSessionId,
          status: isErr ? "error" : isDone ? "done" : "running",
          errorMessage: isErr ? part.state?.error || part.error || null : null,
        });

        if (toolName === "question" && !isDone && !isErr) {
          const provisionalId =
            callKey || `q_${part.messageID || targetSid || "global"}_${part.id || "question"}`;
          this._addPendingQuestion(
            {
              ...input,
              id: provisionalId,
              callID: callKey || provisionalId,
              isSynthetic: true,
              sessionID: targetSid,
              agentId,
            },
            targetSid,
          );
          this.syncPendingQuestions(targetSid).catch(() => []);
          this._queueAgentTask(
            agentId,
            {
              status: "failed",
              label: "Esperando respuesta",
              file: file || "question",
            },
            { immediate: true },
          );
          return agentId;
        }

        if (toolName === "question" && (isDone || isErr)) {
          this._removePendingQuestion(callKey);
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
        } else if (stateStatus === "completed" && isDelegation) {
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
            phase: "working",
            label,
            file,
            delegationEvent:
              isDelegation && Boolean(parentAgent && parentAgent !== agentId && !isDone),
          });
        }
        return agentId;
      }

      if (part.type === "text" || part.type === "reasoning") {
        const sid = part.sessionID || sessionId || this.activeSessionId || "global";
        this.busySessions.set(sid, agentId);
        const partText = typeof part.text === "string" ? part.text : "";
        const delta = typeof props.delta === "string" ? props.delta : "";
        const isReasoning = part.type === "reasoning";
        const isDone = Boolean(part.time?.end);
        const streamId = part.id || part.messageID || "active";
        const sourceKey = part.messageID
          ? `msg:${part.messageID}:part:${part.id || (isReasoning ? "reasoning" : "text")}`
          : null;

        if (isReasoning) {
          const bufKey = `${sid}:${agentId}`;
          const sourceText = partText || `${this.reasoningBuffers.get(bufKey) || ""}${delta}`;
          this.reasoningBuffers.set(bufKey, sourceText.slice(-500));
          this._upsertStreamingLogEntry(sid, {
            streamKey: streamId,
            sourceKey,
            kind: "reasoning",
            agentId,
            deltaText: delta,
            fullText: partText || undefined,
            status: isDone ? "done" : "running",
            replaceContent: Boolean(partText),
          });
          const excerpt = extractReasoningExcerpt(sourceText);
          const bubbleLabel = excerpt ? `Pensando · ${excerpt}` : "Pensando...";
          this._emitLiveKanbanSync({
            sessionId: sid,
            agentId,
            status: "in_progress",
            title: "Pensando...",
            preserveTitle: true,
          });
          this._queueAgentTask(agentId, {
            status: "started",
            phase: "thinking",
            label: bubbleLabel,
            file: null,
          });
        } else {
          this._upsertStreamingLogEntry(sid, {
            streamKey: streamId,
            sourceKey,
            kind: "text",
            agentId,
            deltaText: delta,
            fullText: partText || undefined,
            status: isDone ? "done" : "running",
            replaceContent: Boolean(partText),
          });
          if (isDone && agentId !== "architect") {
            const logs = this.sessionLogsById.get(sid) || [];
            const doneEntry = logs.find(
              (e) =>
                e.kind === "text" &&
                ((sourceKey && e.sourceKey === sourceKey) || e.streamKey === streamId),
            );
            const fullText = doneEntry?.content || partText;
            if (fullText) {
              this._maybeRegisterSpecialistInquiry({
                sessionId: sid,
                agentId,
                messageId: sourceKey || streamId,
                text: fullText,
                onlyIfQuestion: true,
              });
            }
          }
          this._emitLiveKanbanSync({
            sessionId: sid,
            agentId,
            status: "in_progress",
            title: "Redactando respuesta",
            preserveTitle: true,
          });
          this._queueAgentTask(agentId, {
            status: "started",
            phase: "working",
            label: "Redactando respuesta",
            file: null,
          });
        }
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
      phase: payload.phase || "working",
      label: payload.label || "Trabajando en OpenCode",
      file: payload.file || null,
      delegationEvent: Boolean(payload.delegationEvent),
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

  _unwrapResponseData(payload) {
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "data" in payload
    ) {
      return payload.data;
    }
    return payload;
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

      const raw = await probe.resp.json().catch(() => null);
      if (raw === null) {
        return {
          ok: false,
          status: probe.status,
          latencyMs: Math.round(performance.now() - start),
          error: "Respuesta no válida (JSON corrupto en /api/session)",
        };
      }

      const data = this._unwrapResponseData(raw);
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
    const lowerTemplate = String(template || "").toLowerCase();
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
      const lower = key.toLowerCase();
      if (lower.includes("session")) {
        return encodeURIComponent(params.sessionID || "");
      }
      if (lower === "id") {
        const isSessionId = lowerTemplate.includes(`/session/{${lower}}`);
        return encodeURIComponent(
          isSessionId
            ? params.sessionID || ""
            : params.requestID || params.questionID || params.formID || params.sessionID || "",
        );
      }
      if (lower.includes("question")) {
        return encodeURIComponent(params.questionID || params.requestID || "");
      }
      if (lower.includes("form")) {
        return encodeURIComponent(params.formID || params.requestID || "");
      }
      if (lower.includes("request") || lower.includes("permission")) {
        return encodeURIComponent(params.requestID || "");
      }
      return encodeURIComponent(params[key] || "");
    });
  }

  _resolveComponentRef(spec, refString) {
    if (!spec || typeof refString !== "string" || !refString.startsWith("#/")) {
      return null;
    }
    const parts = refString
      .slice(2)
      .split("/")
      .map((seg) => decodeURIComponent(seg.replace(/~1/g, "/").replace(/~0/g, "~")));
    let cursor = spec;
    for (const part of parts) {
      if (!cursor || typeof cursor !== "object") return null;
      cursor = cursor[part];
    }
    return cursor && typeof cursor === "object" ? cursor : null;
  }

  _resolveSchemaRef(spec, schema, seen = new Set()) {
    if (!schema || typeof schema !== "object") return null;
    if (schema.$ref && typeof schema.$ref === "string") {
      if (seen.has(schema.$ref)) return null;
      const nextSeen = new Set(seen);
      nextSeen.add(schema.$ref);
      const target = this._resolveComponentRef(spec, schema.$ref);
      if (target) {
        return this._resolveSchemaRef(spec, target, nextSeen);
      }
    }
    if (Array.isArray(schema.allOf)) {
      const mergedProps = {};
      const mergedReq = [];
      let strict = false;
      for (const item of schema.allOf) {
        const resolved = this._resolveSchemaRef(spec, item, seen);
        if (resolved?.properties) Object.assign(mergedProps, resolved.properties);
        if (Array.isArray(resolved?.required)) mergedReq.push(...resolved.required);
        if (resolved?.additionalProperties === false) strict = true;
      }
      return {
        type: "object",
        properties: mergedProps,
        required: [...new Set(mergedReq)],
        ...(strict ? { additionalProperties: false } : {}),
      };
    }
    if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
      const variants = schema.anyOf || schema.oneOf;
      for (const v of variants) {
        const resolved = this._resolveSchemaRef(spec, v, seen);
        if (resolved?.properties) return resolved;
      }
      for (const v of variants) {
        const resolved = this._resolveSchemaRef(spec, v, seen);
        if (resolved && resolved.type !== "null") return resolved;
      }
    }
    return schema;
  }

  _expandSchemaTree(spec, schema, depth = 0, seen = new Set()) {
    if (!schema || typeof schema !== "object") return null;
    if (depth > 6) return schema;

    if (schema.$ref && typeof schema.$ref === "string") {
      if (seen.has(schema.$ref)) return null;
      const nextSeen = new Set(seen);
      nextSeen.add(schema.$ref);
      const target = this._resolveComponentRef(spec, schema.$ref);
      if (target) {
        return this._expandSchemaTree(spec, target, depth + 1, nextSeen);
      }
    }

    if (Array.isArray(schema.allOf)) {
      const mergedProps = {};
      const mergedReq = [];
      let strict = false;
      let additionalProperties = undefined;
      for (const item of schema.allOf) {
        const expanded = this._expandSchemaTree(spec, item, depth + 1, seen);
        if (!expanded) continue;
        if (expanded.properties) Object.assign(mergedProps, expanded.properties);
        if (Array.isArray(expanded.required)) mergedReq.push(...expanded.required);
        if (expanded.additionalProperties === false) strict = true;
        else if (expanded.additionalProperties && additionalProperties === undefined) {
          additionalProperties = expanded.additionalProperties;
        }
      }
      return {
        type: "object",
        properties: mergedProps,
        required: [...new Set(mergedReq)],
        ...(strict
          ? { additionalProperties: false }
          : additionalProperties !== undefined
            ? { additionalProperties }
            : {}),
      };
    }

    const copy = { ...schema };
    if (Array.isArray(schema.anyOf)) {
      copy.anyOf = schema.anyOf
        .map((v) => this._expandSchemaTree(spec, v, depth + 1, seen))
        .filter(Boolean);
    }
    if (Array.isArray(schema.oneOf)) {
      copy.oneOf = schema.oneOf
        .map((v) => this._expandSchemaTree(spec, v, depth + 1, seen))
        .filter(Boolean);
    }
    if (schema.items && typeof schema.items === "object") {
      copy.items = this._expandSchemaTree(spec, schema.items, depth + 1, seen);
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      copy.additionalProperties = this._expandSchemaTree(
        spec,
        schema.additionalProperties,
        depth + 1,
        seen,
      );
    }
    if (schema.properties && typeof schema.properties === "object") {
      const expandedProps = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        expandedProps[k] = this._expandSchemaTree(spec, v, depth + 1, seen) || v;
      }
      copy.properties = expandedProps;
    }
    return copy;
  }

  _extractBodySchemaInfo(spec, operation) {
    let rawBody = operation?.requestBody;
    if (!rawBody) return null;
    if (rawBody.$ref && typeof rawBody.$ref === "string") {
      rawBody = this._resolveComponentRef(spec, rawBody.$ref) || rawBody;
    }
    const rawSchema =
      rawBody?.content?.["application/json"]?.schema ||
      rawBody?.content?.["*/*"]?.schema ||
      Object.values(rawBody?.content || {})[0]?.schema ||
      null;
    const resolved = this._resolveSchemaRef(spec, rawSchema);
    const expanded = this._expandSchemaTree(spec, rawSchema);
    if (!resolved || typeof resolved !== "object") {
      return { hasBody: true, props: [], required: [], strict: false, schema: expanded };
    }
    const props = resolved.properties ? Object.keys(resolved.properties) : [];
    const required = Array.isArray(resolved.required) ? resolved.required : [];
    const strict = resolved.additionalProperties === false;
    return {
      hasBody: true,
      props,
      required,
      strict,
      schema: expanded || resolved,
    };
  }

  _buildReplyBodiesFromSchema(schemaInfo, context) {
    const schema = schemaInfo?.schema || schemaInfo;
    if (!schema || typeof schema !== "object") return [];

    const {
      effectiveId = "",
      item = {},
      normalizedAnswers = [],
      flatAnswers = [],
      flatText = "",
      reject = false,
    } = context || {};

    const questions = Array.isArray(item?.questions) ? item.questions : [];
    const fieldKeys = questions.map(
      (q, idx) => q?.id || q?.header || q?.question || `field_${idx + 1}`,
    );

    const resolveChoiceLists = (useLabelOverValue = false) =>
      questions.map((q, idx) => {
        const chosen = normalizedAnswers[idx] || [];
        return chosen.map((lbl) => {
          if (useLabelOverValue) return lbl;
          const match = (q?.options || []).find(
            (o) => o.label === lbl || o.value === lbl,
          );
          return match?.value ?? lbl;
        });
      });

    const buildRecordForQuestions = (valSchema, useLabelOverValue = false) => {
      const lists = resolveChoiceLists(useLabelOverValue);
      const record = {};
      questions.forEach((q, idx) => {
        const key = fieldKeys[idx];
        const vals = lists[idx] || [];
        const vsType = valSchema?.type;
        if (vsType === "array") {
          record[key] = vals;
        } else if (vsType === "boolean") {
          record[key] = /^(true|s[ií]|yes|1|accept|confirm|ok)/i.test(vals[0] || "");
        } else if (vsType === "number" || vsType === "integer") {
          const parsed = Number(vals[0]);
          record[key] = Number.isFinite(parsed) ? parsed : 0;
        } else if (vsType === "string") {
          record[key] = vals.join(", ");
        } else {
          // anyOf / string | string[] / unspecified: arreglo si multi-select, string si single
          record[key] = q?.multiple ? vals : (vals[0] ?? "");
        }
      });
      if (questions.length === 0 && flatText) {
        record.answer = flatText;
      }
      return record;
    };

    const buildItemArrayForSchema = (itemsSchema, useLabelOverValue = false) => {
      const lists = resolveChoiceLists(useLabelOverValue);
      if (!itemsSchema || typeof itemsSchema !== "object") {
        return reject ? [] : lists;
      }
      if (itemsSchema.type === "array") {
        return reject ? [] : lists;
      }
      if (itemsSchema.type === "string") {
        return reject ? [] : lists.flat();
      }
      if (itemsSchema.type === "object" || itemsSchema.properties) {
        const itemProps = itemsSchema.properties || {};
        return questions.map((q, idx) => {
          const vals = lists[idx] || [];
          const entry = {};
          for (const [pk, pSchema] of Object.entries(itemProps)) {
            const lowerPk = pk.toLowerCase();
            if (lowerPk === "id" || lowerPk === "fieldid" || lowerPk === "questionid" || lowerPk === "key" || lowerPk === "name") {
              entry[pk] = fieldKeys[idx];
            } else if (lowerPk === "value" || lowerPk === "values" || lowerPk === "answer" || lowerPk === "answers" || lowerPk === "selected" || lowerPk === "text") {
              if (pSchema?.type === "array") entry[pk] = vals;
              else if (pSchema?.type === "boolean") entry[pk] = /^(true|s[ií]|yes|1)/i.test(vals[0] || "");
              else if (pSchema?.type === "string") entry[pk] = vals.join(", ");
              else entry[pk] = q?.multiple ? vals : (vals[0] ?? "");
            }
          }
          if (Object.keys(entry).length === 0) {
            return { id: fieldKeys[idx], value: q?.multiple ? vals : (vals[0] ?? "") };
          }
          return entry;
        });
      }
      return reject ? [] : lists;
    };

    const buildPropValue = (propName, propSchema, useLabelOverValue = false) => {
      const lower = propName.toLowerCase();
      if (!propSchema || typeof propSchema !== "object") {
        return lower.includes("answer") ? normalizedAnswers : flatText;
      }
      if (propSchema.const !== undefined) return propSchema.const;
      if (Array.isArray(propSchema.enum) && propSchema.enum.length > 0) {
        if (reject) {
          const hit = propSchema.enum.find((v) =>
            /reject|cancel|dismiss|decline|skip|abort/i.test(String(v)),
          );
          if (hit !== undefined) return hit;
        } else {
          const hit = propSchema.enum.find((v) =>
            /submit|reply|answer|accept|confirm|complete|ok/i.test(String(v)),
          );
          if (hit !== undefined) return hit;
        }
        return propSchema.enum[0];
      }

      if (lower === "formid" || lower === "form_id") return effectiveId;
      if (lower === "questionid" || lower === "question_id" || lower === "requestid" || lower === "request_id") {
        return effectiveId;
      }
      if (lower === "sessionid" || lower === "session_id") return item?.sessionID || "";
      if (lower === "callid" || lower === "call_id") return item?.callID || "";
      if (lower === "id") return effectiveId;

      if (lower === "reject" || lower === "rejected" || lower === "cancel" || lower === "cancelled" || lower === "canceled" || lower === "dismiss" || lower === "dismissed") {
        return Boolean(reject);
      }
      if (lower === "submitted" || lower === "completed" || lower === "accepted" || lower === "confirmed" || lower === "ok") {
        return !reject;
      }

      const targetType = propSchema.type;
      const lists = resolveChoiceLists(useLabelOverValue);

      if (targetType === "boolean") return !reject;
      if (targetType === "string") return reject ? "" : lists.flat().join(", ");
      if (targetType === "array") {
        return buildItemArrayForSchema(propSchema.items, useLabelOverValue);
      }
      if (targetType === "object" || propSchema.properties || propSchema.additionalProperties) {
        if (propSchema.properties && Object.keys(propSchema.properties).length > 0) {
          const nested = {};
          const reqSet = new Set(propSchema.required || []);
          for (const [nk, ns] of Object.entries(propSchema.properties)) {
            if (
              reqSet.has(nk) ||
              /answer|value|field|data|response|submit|reject|cancel|id/i.test(nk)
            ) {
              nested[nk] = buildPropValue(nk, ns, useLabelOverValue);
            }
          }
          if (Object.keys(nested).length > 0) return nested;
        }
        const apSchema =
          typeof propSchema.additionalProperties === "object"
            ? propSchema.additionalProperties
            : null;
        return buildRecordForQuestions(apSchema, useLabelOverValue);
      }

      // Union dentro de propiedad (ej. answers: string[][] | Record<string, string>)
      const variants = propSchema.anyOf || propSchema.oneOf;
      if (Array.isArray(variants) && variants.length > 0) {
        const preferred =
          variants.find((v) => v?.type === "object" || v?.additionalProperties) ||
          variants.find((v) => v?.type === "array") ||
          variants.find((v) => v?.type === "string") ||
          variants[0];
        return buildPropValue(propName, preferred, useLabelOverValue);
      }

      return lower === "answer" || lower === "reply" || lower === "text"
        ? flatText
        : lists;
    };

    const schemaSupportsReject = (objSchema) => {
      if (!objSchema || typeof objSchema !== "object") return false;
      const props = objSchema.properties || {};
      for (const [pk, ps] of Object.entries(props)) {
        if (/reject|cancel|dismiss|decline|skip|abort/i.test(pk)) return true;
        if (ps?.const !== undefined && /reject|cancel|dismiss/i.test(String(ps.const))) return true;
        if (
          Array.isArray(ps?.enum) &&
          ps.enum.some((v) => /reject|cancel|dismiss/i.test(String(v)))
        ) {
          return true;
        }
      }
      return false;
    };

    const buildFromObjectSchema = (objSchema, useLabelOverValue = false) => {
      if (!objSchema || typeof objSchema !== "object") return null;
      const props = objSchema.properties || {};
      const propKeys = Object.keys(props);

      if (propKeys.length === 0) {
        if (objSchema.additionalProperties) {
          const apSchema =
            typeof objSchema.additionalProperties === "object"
              ? objSchema.additionalProperties
              : null;
          return buildRecordForQuestions(apSchema, useLabelOverValue);
        }
        return reject ? {} : null;
      }

      if (reject && !schemaSupportsReject(objSchema)) {
        return null;
      }

      const payload = {};
      const requiredSet = new Set(objSchema.required || []);
      const answerPropRx =
        /^(answers?|values?|fields?|data|responses?|submission|payload|result|reply|text|content|input|body|action|status|decision|reject|rejected|cancel|cancelled|canceled|dismiss|dismissed|submitted|formid|form_id|questionid|question_id|requestid|request_id)$/i;

      for (const pk of propKeys) {
        const ps = props[pk];
        if (requiredSet.has(pk) || answerPropRx.test(pk)) {
          payload[pk] = buildPropValue(pk, ps, useLabelOverValue);
        }
      }

      // Si no coincidió ninguna clave conocida, poblar la primera propiedad
      if (Object.keys(payload).length === 0) {
        const firstKey = propKeys[0];
        payload[firstKey] = buildPropValue(firstKey, props[firstKey], useLabelOverValue);
      }
      return payload;
    };

    const candidates = [];
    const seenJson = new Set();
    const pushCandidate = (obj) => {
      if (obj === null || obj === undefined) return;
      try {
        const key = JSON.stringify(obj);
        if (!seenJson.has(key)) {
          seenJson.add(key);
          candidates.push(obj);
        }
      } catch {
        // Ignorar payloads no serializables
      }
    };

    const topVariants =
      Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)
        ? (schema.anyOf || schema.oneOf).filter((v) => v && v.type !== "null")
        : [schema];

    // Si es reject, priorizar variantes que expliciten cancel/reject
    const orderedVariants = reject
      ? [
          ...topVariants.filter((v) => schemaSupportsReject(v)),
          ...topVariants.filter((v) => !schemaSupportsReject(v)),
        ]
      : topVariants;

    const hasDistinctLabelValue = questions.some((q) =>
      (q?.options || []).some((o) => o.value && o.label && o.value !== o.label),
    );

    for (const variant of orderedVariants) {
      if (variant.type === "array") {
        if (!reject) {
          pushCandidate(buildItemArrayForSchema(variant.items, false));
          if (hasDistinctLabelValue) {
            pushCandidate(buildItemArrayForSchema(variant.items, true));
          }
        }
        continue;
      }
      if (
        variant.type === "object" ||
        variant.properties ||
        variant.additionalProperties
      ) {
        pushCandidate(buildFromObjectSchema(variant, false));
        if (!reject && hasDistinctLabelValue) {
          pushCandidate(buildFromObjectSchema(variant, true));
        }
      }
    }

    return candidates;
  }

  async _extractHttpError(resp, fallbackText) {
    try {
      const text = await resp.text();
      if (!text) return fallbackText;
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return `${fallbackText}: ${text.trim().slice(0, 140)}`;
      }
      if (!parsed || typeof parsed !== "object") return fallbackText;

      const issueList =
        parsed.issues ||
        parsed.errors ||
        parsed.error?.issues ||
        parsed.error?.errors ||
        null;
      if (Array.isArray(issueList) && issueList.length > 0) {
        const summary = issueList
          .slice(0, 2)
          .map((i) => {
            const field = Array.isArray(i?.path) ? i.path.join(".") : i?.path || "";
            const msg = i?.message || i?.code || "inválido";
            return field ? `${field}: ${msg}` : msg;
          })
          .join("; ");
        return `${fallbackText} (${summary.slice(0, 140)})`;
      }

      const detail =
        (typeof parsed.error === "string" && parsed.error) ||
        parsed.error?.data?.message ||
        parsed.error?.message ||
        parsed.data?.message ||
        (typeof parsed.message === "string" && parsed.message) ||
        (typeof parsed.detail === "string" && parsed.detail) ||
        null;
      if (detail) {
        return `${fallbackText}: ${String(detail).slice(0, 140)}`;
      }
      return `${fallbackText}: ${text.trim().slice(0, 140)}`;
    } catch {
      return fallbackText;
    }
  }

  async _discoverOpenApiCapabilities(baseUrl = this.getActiveBaseUrl(), signal) {
    const cacheKey = `${baseUrl}|${this.apiPrefix}`;
    if (this.capabilitiesCache.has(cacheKey)) {
      const cached = this.capabilitiesCache.get(cacheKey);
      this.capabilities = cached;
      return cached;
    }

    const defaults = {
      discoveredFrom: "defaults",
      createSessionSchema: null,
      activeSessionPath: null,
      sessionStatusPath: `${this.apiPrefix}/session/status`,
      sessionAgentEndpoints: [],
      promptPaths: [
        `${this.apiPrefix}/session/{sessionID}/prompt`,
        `${this.apiPrefix}/session/{sessionID}/prompt_async`,
        `${this.apiPrefix}/session/{sessionID}/message`,
      ],
      promptBodySchemas: {},
      interruptPaths: [
        `${this.apiPrefix}/session/{sessionID}/interrupt`,
        `${this.apiPrefix}/session/{sessionID}/abort`,
      ],
      interruptBodyInfo: {},
      permissionListPaths: [
        `${this.apiPrefix}/permission`,
        `${this.apiPrefix}/session/{sessionID}/permission`,
      ],
      permissionReplyPaths: [
        `${this.apiPrefix}/permission/{requestID}/reply`,
        `${this.apiPrefix}/session/{sessionID}/permission/{requestID}/reply`,
        `${this.apiPrefix}/session/{sessionID}/permissions/{requestID}`,
      ],
      permissionReplySchemas: {},
      messageListPaths: [
        `${this.apiPrefix}/session/{sessionID}/message`,
        `${this.apiPrefix}/session/{sessionID}/messages`,
      ],
      questionListPaths: [
        `${this.apiPrefix}/question`,
        `${this.apiPrefix}/session/{sessionID}/question`,
      ],
      questionReplyPaths: [
        `${this.apiPrefix}/question/{requestID}/reply`,
        `${this.apiPrefix}/session/{sessionID}/question/{requestID}/reply`,
      ],
      questionReplySchemas: {},
      questionRejectPaths: [
        `${this.apiPrefix}/question/{requestID}/reject`,
        `${this.apiPrefix}/session/{sessionID}/question/{requestID}/reject`,
      ],
      questionRejectSchemas: {},
      formListPaths: [
        `${this.apiPrefix}/session/{sessionID}/form`,
        `${this.apiPrefix}/form`,
      ],
      formReplyPaths: [],
      formReplySchemas: {},
      formRejectPaths: [],
      formRejectSchemas: {},
      openapiSpec: null,
    };

    try {
      const specCandidates =
        this.apiPrefix === "" ? ["/doc", "/openapi.json"] : ["/openapi.json", "/doc"];
      let spec = null;
      let specSource = "openapi.json";

      for (const specPath of specCandidates) {
        const resp = await fetch(`${baseUrl}${specPath}`, {
          headers: {
            Accept: "application/json",
            ...this._buildAuthHeaders(),
          },
          signal: signal || AbortSignal.timeout(3000),
        }).catch(() => null);
        if (!resp) continue;
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (!resp.ok || !ct.includes("application/json")) continue;
        const parsed = await resp.json().catch(() => null);
        if (parsed?.paths && typeof parsed.paths === "object") {
          spec = parsed;
          specSource = specPath === "/doc" ? "doc" : "openapi.json";
          break;
        }
      }

      const paths = spec?.paths;
      if (!paths || typeof paths !== "object") {
        this.capabilities = defaults;
        this.capabilitiesCache.set(cacheKey, defaults);
        return defaults;
      }

      this.openapiSpec = spec;

      const promptFound = [];
      const promptBodySchemas = {};
      const interruptFound = [];
      const interruptBodyInfo = {};
      const permListFound = [];
      const permReplyFound = [];
      const permissionReplySchemas = {};
      const messageListFound = [];
      const questionListFound = [];
      const questionReplyFound = [];
      const questionReplySchemas = {};
      const questionRejectFound = [];
      const questionRejectSchemas = {};
      const formListFound = [];
      const formReplyFound = [];
      const formReplySchemas = {};
      const formRejectFound = [];
      const formRejectSchemas = {};
      const sessionAgentEndpoints = [];
      let createSessionSchema = null;
      let activeSessionPath = null;
      let sessionStatusPath = null;

      for (const [rawPath, methods] of Object.entries(paths)) {
        if (!methods || typeof methods !== "object") continue;
        const norm = this._normalizeDiscoveredPath(rawPath);

        if (methods.post) {
          if (/^(\/api)?\/session$/i.test(rawPath)) {
            createSessionSchema = this._extractBodySchemaInfo(spec, methods.post);
          } else if (/\/session\/\{[^}]+\}\/(prompt|prompt_async|message)$/i.test(rawPath)) {
            promptFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            if (info) promptBodySchemas[norm] = info;
          } else if (/\/session\/\{[^}]+\}\/(interrupt|abort)$/i.test(rawPath)) {
            interruptFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            interruptBodyInfo[norm] = Boolean(info?.hasBody);
          } else if (
            /\/permission\/\{[^}]+\}\/reply$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/permissions\/\{[^}]+\}$/i.test(rawPath)
          ) {
            permReplyFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            if (info) permissionReplySchemas[norm] = info;
          } else if (
            /\/question\/\{[^}]+\}\/(reply|answer|submit)$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/question\/\{[^}]+\}\/(reply|answer|submit)$/i.test(rawPath) ||
            /\/question\/\{[^}]+\}$/i.test(rawPath)
          ) {
            questionReplyFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            if (info) questionReplySchemas[norm] = info;
          } else if (
            /\/question\/\{[^}]+\}\/(reject|cancel|dismiss)$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/question\/\{[^}]+\}\/(reject|cancel|dismiss)$/i.test(rawPath)
          ) {
            questionRejectFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            if (info) questionRejectSchemas[norm] = info;
          } else if (
            /\/form\/\{[^}]+\}\/(reply|answer|submit)$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/form\/\{[^}]+\}(\/(reply|answer|submit))?$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/form\/(reply|answer|submit)$/i.test(rawPath) ||
            /\/form\/\{[^}]+\}$/i.test(rawPath)
          ) {
            formReplyFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            if (info) formReplySchemas[norm] = info;
          } else if (
            /\/form\/\{[^}]+\}\/(reject|cancel|dismiss)$/i.test(rawPath) ||
            /\/session\/\{[^}]+\}\/form\/\{[^}]+\}\/(reject|cancel|dismiss)$/i.test(rawPath)
          ) {
            formRejectFound.push(norm);
            const info = this._extractBodySchemaInfo(spec, methods.post);
            if (info) formRejectSchemas[norm] = info;
          } else if (/\/session\/\{[^}]+\}\/agent$/i.test(rawPath)) {
            sessionAgentEndpoints.push({
              method: "POST",
              path: norm,
              schema: this._extractBodySchemaInfo(spec, methods.post),
            });
          }
        }

        if (methods.patch && /\/session\/\{[^}]+\}\/agent$/i.test(rawPath)) {
          sessionAgentEndpoints.unshift({
            method: "PATCH",
            path: norm,
            schema: this._extractBodySchemaInfo(spec, methods.patch),
          });
        }

        if (methods.get) {
          if (/^(\/api)?\/session\/active$/i.test(rawPath)) {
            activeSessionPath = norm;
          } else if (/^(\/api)?\/session\/status$/i.test(rawPath)) {
            sessionStatusPath = norm;
          } else if (/\/session\/\{[^}]+\}\/messages?$/i.test(rawPath)) {
            messageListFound.push(norm);
          } else if (/\/permission$/i.test(rawPath)) {
            permListFound.push(norm);
          } else if (/\/(question)s?$/i.test(rawPath)) {
            questionListFound.push(norm);
          } else if (/\/(form)s?$/i.test(rawPath)) {
            formListFound.push(norm);
          }
        }
      }

      const unique = (arr) => [...new Set(arr)];
      const rankInteractiveReplyPath = (p) => {
        const hasAction = /\/(reply|answer|submit)$/i.test(p) ? 0 : 1;
        const hasId = /\{[^}]+\}/.test(p.split("/form").pop() || p.split("/question").pop() || "")
          ? 0
          : 1;
        const hasSession = p.includes("/session/") ? 0 : 1;
        return hasAction * 10 + hasId * 4 + hasSession;
      };
      questionReplyFound.sort(
        (a, b) => rankInteractiveReplyPath(a) - rankInteractiveReplyPath(b),
      );
      formReplyFound.sort(
        (a, b) => rankInteractiveReplyPath(a) - rankInteractiveReplyPath(b),
      );
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
            ? 1
            : -1,
      );
      messageListFound.sort((a, b) =>
        a.endsWith("/message") === b.endsWith("/message")
          ? 0
          : a.endsWith("/message")
            ? -1
            : 1,
      );

      // Estricto según el OpenAPI descubierto: no mezclar URLs fallback que producirían HTTP 404
      this.capabilities = {
        discoveredFrom: specSource,
        openapiSpec: spec,
        createSessionSchema,
        activeSessionPath,
        sessionStatusPath,
        sessionAgentEndpoints,
        promptPaths: promptFound.length > 0 ? unique(promptFound) : defaults.promptPaths,
        promptBodySchemas,
        interruptPaths: interruptFound.length > 0 ? unique(interruptFound) : defaults.interruptPaths,
        interruptBodyInfo,
        permissionListPaths: unique(permListFound),
        permissionReplyPaths:
          permReplyFound.length > 0 ? unique(permReplyFound) : defaults.permissionReplyPaths,
        permissionReplySchemas,
        messageListPaths:
          messageListFound.length > 0 ? unique(messageListFound) : defaults.messageListPaths,
        questionListPaths: unique(questionListFound),
        questionReplyPaths: unique(questionReplyFound),
        questionReplySchemas,
        questionRejectPaths: unique(questionRejectFound),
        questionRejectSchemas,
        formListPaths: unique(formListFound),
        formReplyPaths: unique(formReplyFound),
        formReplySchemas,
        formRejectPaths: unique(formRejectFound),
        formRejectSchemas,
      };
      this.capabilitiesCache.set(cacheKey, this.capabilities);
      return this.capabilities;
    } catch {
      this.capabilities = defaults;
      this.capabilitiesCache.set(cacheKey, defaults);
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

    for (const template of caps.permissionListPaths || []) {
      if (this.deadGetPaths.has(template)) continue;
      const path = this._fillEndpointTemplate(template, { sessionID: sessionId });
      try {
        const resp = await fetch(`${baseUrl}${path}`, {
          headers,
          signal: signal || AbortSignal.timeout(3000),
        });
        if (resp.status === 404 || resp.status === 405) {
          this.deadGetPaths.add(template);
          continue;
        }
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        if (!resp.ok || !ct.includes("application/json")) continue;

        const raw = await resp.json().catch(() => null);
        const data = this._unwrapResponseData(raw);
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

  async syncPendingQuestions(
    sessionId = this.activeSessionId,
    signal,
    { force = false } = {},
  ) {
    const syncKey = sessionId || "__global__";
    if (!force && this.questionSyncInFlight.has(syncKey)) {
      return this.questionSyncInFlight.get(syncKey);
    }
    const lastAt = this.questionSyncLastAt.get(syncKey) || 0;
    if (!force && Date.now() - lastAt < 400) {
      return this.getPendingQuestions();
    }

    const runner = (async () => {
      const baseUrl = this.getActiveBaseUrl();
      const caps = this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl, signal));
      const headers = {
        Accept: "application/json",
        ...this._buildAuthHeaders(),
      };

      const candidateTemplates = [
        ...new Set([
          ...(caps.questionListPaths || []),
          ...(caps.formListPaths || []),
        ]),
      ];

      for (const template of candidateTemplates) {
        if (this.deadGetPaths.has(template)) continue;
        if (template.includes("{sessionID}") && !sessionId) continue;
        const path = this._fillEndpointTemplate(template, { sessionID: sessionId || "" });
        try {
          const resp = await fetch(`${baseUrl}${path}`, {
            headers,
            signal: signal || AbortSignal.timeout(3000),
          });
          if (resp.status === 404 || resp.status === 405) {
            this.deadGetPaths.add(template);
            continue;
          }
          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          if (!resp.ok || !ct.includes("application/json")) continue;

          const raw = await resp.json().catch(() => null);
          const data = this._unwrapResponseData(raw);
          const list = Array.isArray(data)
            ? data
            : Array.isArray(data?.questions)
              ? data.questions
              : Array.isArray(data?.forms)
                ? data.forms
                : Array.isArray(data?.items)
                  ? data.items
                  : Array.isArray(data?.pending)
                    ? data.pending
                    : data &&
                        typeof data === "object" &&
                        (data.id ||
                          data.requestID ||
                          data.questionID ||
                          data.formID ||
                          data.callID ||
                          Array.isArray(data.questions) ||
                          typeof data.question === "string")
                      ? [data]
                      : [];

          let addedAny = false;
          for (const q of list) {
            if (this._isQuestionDismissed(q, sessionId)) {
              continue;
            }
            const itemStatus = String(q?.status || q?.state?.status || "").toLowerCase();
            if (
              itemStatus === "replied" ||
              itemStatus === "answered" ||
              itemStatus === "rejected" ||
              itemStatus === "completed" ||
              itemStatus === "submitted"
            ) {
              continue;
            }
            const resolvedSessionAgent =
              sessionId &&
              (this.taskCallsByChildSession.get(sessionId) ||
                this.resolveAgentId(this.sessionAgentMap.get(sessionId)) ||
                this.resolveAgentId(this.sessionsById.get(sessionId)?.agent));
            const enrichedQuestion =
              resolvedSessionAgent && !q.agentId && !q.agent
                ? { ...q, agentId: resolvedSessionAgent }
                : q;
            const added = this._addPendingQuestion(enrichedQuestion, sessionId);
            if (added) addedAny = true;
          }
          if (addedAny) break;
        } catch {
          // Probar siguiente ruta candidata
        }
      }
      this.questionSyncLastAt.set(syncKey, Date.now());
      return this.getPendingQuestions();
    })();

    this.questionSyncInFlight.set(syncKey, runner);
    try {
      return await runner;
    } finally {
      this.questionSyncInFlight.delete(syncKey);
    }
  }

  async syncAllActiveSessionsQuestions(signal, { force = false } = {}) {
    const candidateSids = new Set();
    if (this.activeSessionId) candidateSids.add(this.activeSessionId);
    for (const sid of this.busySessions.keys()) {
      if (sid) candidateSids.add(sid);
    }
    for (const childSet of this.childSessionsByParent.values()) {
      for (const cid of childSet) {
        if (cid) candidateSids.add(cid);
      }
    }
    for (const sid of this.agentPreferredSessionMap.values()) {
      if (sid) candidateSids.add(sid);
    }

    const targets = Array.from(candidateSids).slice(0, 8);
    if (targets.length === 0) {
      return this.syncPendingQuestions(null, signal, { force });
    }
    await Promise.all(
      targets.map((sid) =>
        this.syncPendingQuestions(sid, signal, { force }).catch(() => []),
      ),
    );
    return this.getPendingQuestions();
  }

  _normalizeHistoryMessages(rawList, sessionId) {
    const entries = [];
    const sessionRecord = this.sessionsById.get(sessionId);
    const defaultAgent =
      this.resolveAgentId(this.sessionAgentMap.get(sessionId)) ||
      this.resolveAgentId(sessionRecord?.agent) ||
      "architect";

    const list = Array.isArray(rawList) ? rawList : [];
    for (let mIdx = 0; mIdx < list.length; mIdx += 1) {
      const msg = list[mIdx];
      if (!msg || typeof msg !== "object") continue;

      const info = msg.info && typeof msg.info === "object" ? msg.info : msg;
      const msgId = info.id || msg.id || `hist_${mIdx}`;
      const role = String(info.role || msg.role || "assistant").toLowerCase();
      const msgTime = info.time?.created || info.createdAt || msg.timestamp || Date.now() + mIdx;
      const msgAgent =
        this.resolveAgentId(info.agent || msg.agent) || defaultAgent;

      const parts = Array.isArray(msg.parts)
        ? msg.parts
        : Array.isArray(info.parts)
          ? info.parts
          : null;

      if (role === "user") {
        let userText = "";
        if (parts && parts.length > 0) {
          userText = parts
            .filter(
              (p) =>
                p &&
                !p.synthetic &&
                !p.ignored &&
                (p.type === "text" || typeof p.text === "string"),
            )
            .map((p) => String(p.text || ""))
            .join("\n")
            .trim();
        } else if (typeof info.content === "string") {
          userText = info.content.trim();
        } else if (typeof msg.text === "string") {
          userText = msg.text.trim();
        }
        if (userText) {
          entries.push({
            id: `hist_prompt_${msgId}`,
            sourceKey: `msg:${msgId}:user`,
            callKey: null,
            sessionId,
            kind: "prompt",
            agentId: msgAgent,
            toolName: null,
            target: null,
            isDelegation: false,
            subagentId: null,
            childSessionId: null,
            content: userText,
            status: "done",
            timestamp: msgTime,
          });
        }
        continue;
      }

      if (parts && parts.length > 0) {
        for (let pIdx = 0; pIdx < parts.length; pIdx += 1) {
          const part = parts[pIdx];
          if (!part || typeof part !== "object" || part.synthetic || part.ignored) continue;
          const partId = part.id || `p${pIdx}`;
          const partTime = part.time?.start || part.time?.end || msgTime + pIdx;
          const sourceKey = `msg:${msgId}:part:${partId}`;

          if (part.type === "reasoning") {
            const text = String(part.text || "").trim();
            if (!text) continue;
            entries.push({
              id: `hist_reasoning_${msgId}_${partId}`,
              sourceKey,
              callKey: null,
              sessionId,
              kind: "reasoning",
              agentId: this.resolveAgentId(part.agent) || msgAgent,
              toolName: null,
              target: null,
              isDelegation: false,
              subagentId: null,
              childSessionId: null,
              content: text,
              status: part.time?.end === false ? "running" : "done",
              timestamp: partTime,
            });
          } else if (part.type === "tool") {
            const toolName = String(part.tool || part.name || "tool").toLowerCase();
            const input = this._extractToolInputPayload(part);
            const metaObj = part.state?.metadata || part.metadata || {};
            const stateStatus = String(part.state?.status || "completed").toLowerCase();
            const callKey = part.callID || part.id || null;
            const isDelegation = isDelegationToolName(toolName);
            const file = formatToolTarget(input);

            if (toolName === "question" && (stateStatus === "running" || stateStatus === "pending")) {
              const provisionalId =
                callKey || `q_${msgId}_${partId}_question`;
              this._addPendingQuestion(
                {
                  ...input,
                  id: provisionalId,
                  callID: callKey || provisionalId,
                  isSynthetic: true,
                  sessionID: sessionId,
                  agentId: msgAgent,
                },
                sessionId,
              );
              this.syncPendingQuestions(sessionId).catch(() => []);
            }

            let subagentId = null;
            if (isDelegation) {
              subagentId = this._resolveEventAgentId("message.part.updated", {
                part,
                sessionID: sessionId,
              });
            }
            const childSessionId =
              metaObj.sessionId || metaObj.sessionID || metaObj.childSessionId || null;
            if (isDelegation && childSessionId) {
              this._registerChildSession(sessionId, childSessionId, {
                agent: subagentId,
                title: file || input.description || "",
              });
            }

            const logTarget =
              isDelegation && subagentId && subagentId !== msgAgent
                ? `@${subagentId}${file ? ` · ${file}` : ""}`
                : file ||
                  (typeof input.description === "string"
                    ? input.description.slice(0, 40)
                    : null);

            entries.push({
              id: `hist_tool_${msgId}_${partId}`,
              sourceKey,
              callKey,
              sessionId,
              kind: "tool",
              agentId: msgAgent,
              toolName,
              target: logTarget,
              isDelegation,
              subagentId,
              childSessionId,
              content:
                stateStatus === "error"
                  ? String(part.state?.error || part.error || "")
                  : "",
              status:
                stateStatus === "error"
                  ? "error"
                  : stateStatus === "running" || stateStatus === "pending"
                    ? "running"
                    : "done",
              timestamp: partTime,
            });
          } else if (part.type === "text") {
            const text = String(part.text || "").trim();
            if (!text) continue;
            entries.push({
              id: `hist_text_${msgId}_${partId}`,
              sourceKey,
              callKey: null,
              sessionId,
              kind: "text",
              agentId: this.resolveAgentId(part.agent) || msgAgent,
              toolName: null,
              target: null,
              isDelegation: false,
              subagentId: null,
              childSessionId: null,
              content: text,
              status: part.time?.end === false ? "running" : "done",
              timestamp: partTime,
            });
          }
        }
      } else if (typeof info.content === "string" && info.content.trim()) {
        entries.push({
          id: `hist_text_${msgId}`,
          sourceKey: `msg:${msgId}:text`,
          callKey: null,
          sessionId,
          kind: "text",
          agentId: msgAgent,
          toolName: null,
          target: null,
          isDelegation: false,
          subagentId: null,
          childSessionId: null,
          content: info.content.trim(),
          status: "done",
          timestamp: msgTime,
        });
      }

      if (info.error) {
        const errMsg =
          info.error?.data?.message || info.error?.message || info.error?.name || String(info.error);
        if (errMsg) {
          entries.push({
            id: `hist_err_${msgId}`,
            sourceKey: `msg:${msgId}:err`,
            callKey: null,
            sessionId,
            kind: "error",
            agentId: msgAgent,
            toolName: null,
            target: null,
            isDelegation: false,
            subagentId: null,
            childSessionId: null,
            content: errMsg,
            status: "error",
            timestamp: msgTime + 99,
          });
        }
      }
    }

    return entries;
  }

  _mergeHydratedLogEntries(sessionId, hydratedEntries) {
    const { sid, list } = this._ensureSessionLogList(sessionId);
    const merged = [...hydratedEntries];

    // Vincular sesiones hijas huérfanas con entradas de delegación si aún no tenían childSessionId
    const childIds = this.getChildSessionIds(sid);
    if (childIds.length > 0) {
      const usedChildren = new Set(merged.map((e) => e.childSessionId).filter(Boolean));
      const remainingChildren = childIds.filter((cid) => !usedChildren.has(cid));
      for (const cid of remainingChildren) {
        const sess = this.sessionsById.get(cid);
        const childAgent =
          this.taskCallsByChildSession.get(cid) ||
          this.resolveAgentId(sess?.agent) ||
          this._inferSubagentFromText(sess?.title || "");
        const match =
          (childAgent &&
            merged.find(
              (e) =>
                e.kind === "tool" &&
                e.isDelegation &&
                !e.childSessionId &&
                e.subagentId === childAgent,
            )) ||
          merged.find((e) => e.kind === "tool" && e.isDelegation && !e.childSessionId);
        if (match) {
          match.childSessionId = cid;
        }
      }
    }

    // Conservar entradas SSE en vivo que aún no aparezcan en el snapshot REST
    for (const live of list) {
      const idx = merged.findIndex((h) => {
        if (live.sourceKey && h.sourceKey && live.sourceKey === h.sourceKey) return true;
        if (live.callKey && h.callKey && live.callKey === h.callKey) return true;
        if (
          live.kind === "prompt" &&
          h.kind === "prompt" &&
          live.content.trim() === h.content.trim()
        ) {
          return true;
        }
        return false;
      });
      if (idx === -1) {
        merged.push(live);
      } else {
        // Si la entrada en vivo tenía más detalle (p. ej. streaming reciente o childSessionId), conservarlo
        if (live.childSessionId && !merged[idx].childSessionId) {
          merged[idx].childSessionId = live.childSessionId;
        }
        if (live.content && live.content.length > merged[idx].content.length) {
          merged[idx].content = live.content;
        }
        if (live.status === "running" && merged[idx].status !== "done") {
          merged[idx].status = "running";
        }
      }
    }

    if (merged.length > MAX_SESSION_LOG_ENTRIES) {
      merged.splice(0, merged.length - MAX_SESSION_LOG_ENTRIES);
    }
    this.sessionLogsById.set(sid, merged);
    this._emitSessionLog(sid);
    return merged;
  }

  async hydrateSessionHistory(sessionId, { force = false } = {}) {
    const sid = sessionId || this.activeSessionId;
    if (!sid) return [];

    const currentState = this.sessionHistoryState.get(sid);
    if (!force && currentState?.status === "loaded") {
      return this.getSessionLog(sid);
    }
    if (this.historyFetchPromises.has(sid)) {
      return this.historyFetchPromises.get(sid);
    }

    const promise = (async () => {
      this.sessionHistoryState.set(sid, {
        status: "loading",
        error: null,
        lastSyncedAt: currentState?.lastSyncedAt || null,
      });
      this._emitConnectionState();

      const baseUrl = this.getActiveBaseUrl();
      const caps =
        this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));
      const headers = {
        Accept: "application/json",
        ...this._buildAuthHeaders(),
      };

      let lastErr = null;
      let loaded = false;

      for (const template of caps.messageListPaths || []) {
        const path = this._fillEndpointTemplate(template, { sessionID: sid });
        try {
          const resp = await fetch(`${baseUrl}${path}`, {
            headers,
            signal: AbortSignal.timeout(6000),
          });
          if (resp.status === 404 || resp.status === 405) {
            continue;
          }
          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("text/html")) {
            continue;
          }
          if (!resp.ok) {
            lastErr = await this._extractHttpError(
              resp,
              `Error HTTP ${resp.status} cargando historial`,
            );
            continue;
          }

          const raw = await resp.json().catch(() => []);
          const data = this._unwrapResponseData(raw);
          const rawMessages = Array.isArray(data)
            ? data
            : Array.isArray(data?.messages)
              ? data.messages
              : [];

          const normalized = this._normalizeHistoryMessages(rawMessages, sid);
          this._mergeHydratedLogEntries(sid, normalized);
          this.sessionHistoryState.set(sid, {
            status: "loaded",
            error: null,
            lastSyncedAt: Date.now(),
          });
          loaded = true;
          break;
        } catch (err) {
          lastErr = err?.message || "No se pudo cargar el historial";
        }
      }

      if (!loaded) {
        this.sessionHistoryState.set(sid, {
          status: lastErr ? "error" : "loaded",
          error: lastErr || null,
          lastSyncedAt: Date.now(),
        });
      }

      this._emitConnectionState();
      return this.getSessionLog(sid);
    })().finally(() => {
      this.historyFetchPromises.delete(sid);
    });

    this.historyFetchPromises.set(sid, promise);
    return promise;
  }

  async createSession({ title = "", agent = "architect", purgeOthers = false } = {}) {
    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));
    const schema = caps.createSessionSchema;

    const candidates = [];
    const pushUnique = (obj) => {
      const key = JSON.stringify(obj);
      if (!candidates.some((c) => JSON.stringify(c) === key)) {
        candidates.push(obj);
      }
    };

    if (schema?.props?.length) {
      const body = {};
      const allowed = new Set(schema.props);
      if (agent && allowed.has("agent")) {
        body.agent = agent;
      }
      if (title && String(title).trim() && allowed.has("title")) {
        body.title = String(title).trim().slice(0, 64);
      }
      if (Object.keys(body).length > 0) pushUnique(body);
      pushUnique({});
    } else {
      if (agent) pushUnique({ agent });
      if (title && String(title).trim()) {
        pushUnique({ title: String(title).trim().slice(0, 64) });
      }
      pushUnique({});
    }

    let lastErr = "No se pudo crear la sesión";
    for (const payload of candidates) {
      const resp = await fetch(`${baseUrl}${this.apiPrefix}/session`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...this._buildAuthHeaders(),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(6000),
      });

      if (resp.status === 400 || resp.status === 422) {
        lastErr = await this._extractHttpError(
          resp,
          `HTTP ${resp.status} creando sesión`,
        );
        continue;
      }

      const ct = (resp.headers.get("content-type") || "").toLowerCase();
      if (!resp.ok) {
        throw new Error(
          resp.status === 401
            ? "Autenticación requerida (401)"
            : await this._extractHttpError(resp, `Error HTTP ${resp.status} creando sesión`),
        );
      }
      if (!ct.includes("application/json")) {
        throw new Error("OpenCode devolvió HTML en lugar de JSON al crear sesión");
      }

      const rawJson = await resp.json();
      const session = this._unwrapResponseData(rawJson);
      if (session?.id) {
        if (purgeOthers) {
          this._purgePendingQuestions({
            exceptSessionId: session.id,
            reason: "new_session",
            kanbanLabel: "Sesión anterior cerrada",
            taskLabel: "Nueva sesión activa",
          });
        }
        if (agent) {
          this.sessionAgentMap.set(session.id, agent);
          this._trackAgentSession(agent, session.id, { forcePreferred: true });
        }
        this._upsertSessionRecord({ ...session, agent: session.agent || agent });
        if (!agent || agent === "architect" || !this.activeSessionId) {
          this.activeSessionId = session.id;
        }
        this._emitConnectionState();
        return session;
      }
    }

    throw new Error(lastErr);
  }

  async _switchSessionAgent(sessionId, agent, caps) {
    if (!sessionId || !agent || !caps?.sessionAgentEndpoints?.length) return false;
    const baseUrl = this.getActiveBaseUrl();
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this._buildAuthHeaders(),
    };

    for (const ep of caps.sessionAgentEndpoints) {
      const path = this._fillEndpointTemplate(ep.path, { sessionID: sessionId });
      const props = ep.schema?.props || [];
      const payload = props.includes("name")
        ? { name: agent }
        : props.includes("agentID")
          ? { agentID: agent }
          : { agent };
      try {
        const resp = await fetch(`${baseUrl}${path}`, {
          method: ep.method,
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(2500),
        });
        if (resp.ok) return true;
      } catch {
        // Mejor esfuerzo; continuar con prompt
      }
    }
    return false;
  }

  _buildPromptPayloads(template, cleanText, agent, caps) {
    const schema = caps?.promptBodySchemas?.[template];
    const props = schema?.props || [];
    const isStrict = Boolean(schema?.strict && props.length > 0);
    const hasText = props.includes("text");
    const hasParts = props.includes("parts");
    const hasMessage = props.includes("message");
    const hasContent = props.includes("content");
    const allowsAgent = props.length > 0 ? props.includes("agent") : false;

    const candidates = [];
    const pushUnique = (obj) => {
      const key = JSON.stringify(obj);
      if (!candidates.some((c) => JSON.stringify(c) === key)) {
        candidates.push(obj);
      }
    };

    const partsBody = { parts: [{ type: "text", text: cleanText }] };
    const textBody = { text: cleanText };

    if (isStrict) {
      if (hasText) {
        if (agent && allowsAgent) pushUnique({ agent, ...textBody });
        pushUnique(textBody);
      }
      if (hasParts) {
        if (agent && allowsAgent) pushUnique({ agent, ...partsBody });
        pushUnique(partsBody);
      }
      if (hasMessage) {
        if (agent && allowsAgent) pushUnique({ agent, message: cleanText });
        pushUnique({ message: cleanText });
      }
      if (hasContent) {
        if (agent && allowsAgent) pushUnique({ agent, content: cleanText });
        pushUnique({ content: cleanText });
      }
      if (candidates.length > 0) return candidates;
    }

    if (hasText && !hasParts) {
      if (agent && allowsAgent) pushUnique({ agent, ...textBody });
      pushUnique(textBody);
      pushUnique(partsBody);
    } else if (hasParts && !hasText) {
      if (agent && allowsAgent) pushUnique({ agent, ...partsBody });
      pushUnique(partsBody);
      pushUnique(textBody);
    } else {
      pushUnique(textBody);
      pushUnique(partsBody);
      if (agent) pushUnique({ agent, ...textBody });
      if (agent) pushUnique({ agent, ...partsBody });
    }

    if (hasMessage) {
      pushUnique({ message: cleanText });
    }
    if (hasContent) {
      pushUnique({ content: cleanText });
    }

    return candidates;
  }

  async sendPrompt({
    sessionId = null,
    agent = "architect",
    text = "",
    useActiveFallback = true,
  } = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) {
      return { ok: false, error: "Escribe una instrucción antes de enviar." };
    }

    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));

    let targetSessionId =
      sessionId || (useActiveFallback ? this.activeSessionId : null);
    if (!targetSessionId) {
      try {
        const created = await this.createSession({
          title: cleanText.slice(0, 36),
          agent,
          purgeOthers: false,
        });
        targetSessionId = created?.id;
      } catch (createErr) {
        return {
          ok: false,
          error: createErr?.message || "No se pudo crear una sesión activa.",
        };
      }
    }

    if (!targetSessionId) {
      return { ok: false, error: "No se pudo obtener una sesión activa." };
    }

    if (!this.activeSessionId || agent === "architect") {
      this.activeSessionId = targetSessionId;
    }
    if (agent) {
      this.sessionAgentMap.set(targetSessionId, agent);
      this._trackAgentSession(agent, targetSessionId, { forcePreferred: true });
      this.markAgentThreadViewed(agent, targetSessionId);
      this._upsertSessionRecord({
        id: targetSessionId,
        agent,
        updatedAt: Date.now(),
      });
      await this._switchSessionAgent(targetSessionId, agent, caps);
    }

    const controller = new AbortController();
    this.promptAbortControllers.add(controller);

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this._buildAuthHeaders(),
    };

    let lastHttpError = null;

    try {
      for (const template of caps.promptPaths) {
        const path = this._fillEndpointTemplate(template, {
          sessionID: targetSessionId,
        });
        const payloadCandidates = this._buildPromptPayloads(
          template,
          cleanText,
          agent,
          caps,
        );

        for (const body of payloadCandidates) {
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
            const targetAgentId = this.resolveAgentId(agent) || "architect";
            this.busySessions.set(targetSessionId, targetAgentId);
            const { list } = this._ensureSessionLogList(targetSessionId);
            const alreadyLogged = list.some(
              (e) => e.kind === "prompt" && e.content.trim() === cleanText,
            );
            if (!alreadyLogged) {
              this._appendSessionLogEntry(targetSessionId, {
                kind: "prompt",
                agentId: targetAgentId,
                content: cleanText,
                status: "done",
              });
            }
            this._emitLiveKanbanSync({
              sessionId: targetSessionId,
              agentId: targetAgentId,
              status: "in_progress",
              title: cleanText.slice(0, 48),
            });
            this._queueAgentTask(targetAgentId, {
              status: "started",
              phase: "working",
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
            break;
          }
          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("text/html")) {
            break;
          }
          if (resp.status === 400 || resp.status === 422) {
            lastHttpError = await this._extractHttpError(
              resp,
              `HTTP ${resp.status} en ${path}`,
            );
            continue;
          }
          if (!resp.ok) {
            if (resp.status === 401) {
              return {
                ok: false,
                status: 401,
                error: "Credenciales Basic Auth inválidas (401)",
              };
            }
            lastHttpError = await this._extractHttpError(
              resp,
              `HTTP ${resp.status} en ${path}`,
            );
            break;
          }

          const targetAgentId = this.resolveAgentId(agent) || "architect";
          this.busySessions.set(targetSessionId, targetAgentId);
          const { list } = this._ensureSessionLogList(targetSessionId);
          const alreadyLogged = list.some(
            (e) => e.kind === "prompt" && e.content.trim() === cleanText,
          );
          if (!alreadyLogged) {
            this._appendSessionLogEntry(targetSessionId, {
              kind: "prompt",
              agentId: targetAgentId,
              content: cleanText,
              status: "done",
            });
          }
          this._emitLiveKanbanSync({
            sessionId: targetSessionId,
            agentId: targetAgentId,
            status: "in_progress",
            title: cleanText.slice(0, 48),
          });
          this._queueAgentTask(targetAgentId, {
            status: "started",
            phase: "working",
            label: "Prompt recibido",
            file: null,
          });
          return { ok: true, sessionId: targetSessionId, endpoint: path };
        }
      }

      return {
        ok: false,
        error:
          lastHttpError ||
          "No se encontró un endpoint compatible (/prompt o /message)",
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

    const targetSid = sessionId || this.activeSessionId || null;
    if (targetSid) {
      this._purgePendingQuestions({
        sessionId: targetSid,
        reason: "interrupted",
        kanbanLabel: "Ejecución detenida",
        taskLabel: "Ejecución detenida",
        persistDismiss: true,
      });
    } else {
      this._purgePendingQuestions({
        reason: "interrupted",
        kanbanLabel: "Ejecución detenida",
        taskLabel: "Ejecución detenida",
        persistDismiss: true,
      });
    }

    if (!targetSid) {
      return { ok: false, error: "No hay sesión activa para detener." };
    }

    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));
    const headers = {
      Accept: "application/json",
      ...this._buildAuthHeaders(),
    };

    let lastHttpError = null;
    const interruptAgentId =
      this.busySessions.get(targetSid) ||
      this.resolveAgentId(this.sessionAgentMap.get(targetSid)) ||
      "architect";

    for (const template of caps.interruptPaths) {
      const path = this._fillEndpointTemplate(template, {
        sessionID: targetSid,
      });
      const expectsBody = Boolean(caps.interruptBodyInfo?.[template]);
      const attemptBodies = expectsBody
        ? [JSON.stringify({}), undefined]
        : [undefined, JSON.stringify({})];

      for (const body of attemptBodies) {
        try {
          const resp = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: body
              ? { ...headers, "Content-Type": "application/json" }
              : headers,
            ...(body ? { body } : {}),
            signal: AbortSignal.timeout(4000),
          });
          const ct = (resp.headers.get("content-type") || "").toLowerCase();
          if (resp.status === 404 || resp.status === 405 || ct.includes("text/html")) {
            break;
          }
          if (resp.status === 400 || resp.status === 422) {
            lastHttpError = await this._extractHttpError(
              resp,
              `HTTP ${resp.status} al detener sesión`,
            );
            continue;
          }
          if (!resp.ok) {
            return {
              ok: false,
              error: await this._extractHttpError(
                resp,
                `HTTP ${resp.status} al detener sesión`,
              ),
            };
          }
          this._releaseSessionNow(targetSid, interruptAgentId, {
            status: "passed",
            label: "Ejecución detenida",
          });
          return { ok: true, endpoint: path };
        } catch (err) {
          if (err?.name === "TimeoutError") {
            this._releaseSessionNow(targetSid, interruptAgentId, {
              status: "passed",
              label: "Ejecución detenida",
            });
            return { ok: false, error: "Tiempo de espera agotado al detener" };
          }
        }
      }
    }

    this._releaseSessionNow(targetSid, interruptAgentId, {
      status: "passed",
      label: "Ejecución detenida",
    });
    return {
      ok: false,
      error:
        lastHttpError ||
        "No se encontró endpoint /interrupt o /abort en OpenCode",
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

    let lastHttpError = null;

    for (const template of caps.permissionReplyPaths) {
      if (template.includes("{sessionID}") && !item.sessionID) continue;
      const path = this._fillEndpointTemplate(template, {
        sessionID: item.sessionID || "",
        requestID: requestId,
      });

      const schemaProps = caps.permissionReplySchemas?.[template]?.props || [];
      let bodyCandidates;
      if (schemaProps.includes("decision")) {
        bodyCandidates = [{ decision: validResp }];
      } else if (schemaProps.includes("reply")) {
        bodyCandidates = [{ reply: validResp }, { decision: validResp }];
      } else if (schemaProps.includes("response")) {
        bodyCandidates = [{ response: validResp }, { decision: validResp }];
      } else {
        bodyCandidates = [
          { decision: validResp },
          { reply: validResp },
          { response: validResp },
        ];
      }

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
            lastHttpError = await this._extractHttpError(
              resp,
              `HTTP ${resp.status} al responder permiso`,
            );
            continue;
          }
          if (!resp.ok) {
            return {
              ok: false,
              error: await this._extractHttpError(
                resp,
                `Error HTTP ${resp.status} al responder permiso`,
              ),
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
      error:
        lastHttpError ||
        "No se encontró endpoint compatible de permisos (/permission/.../reply)",
    };
  }

  _resolveQuestionTarget(requestId) {
    const mappedId = this.questionCallIdMap.get(requestId) || requestId;
    const item =
      this.pendingQuestions.get(mappedId) ||
      this.pendingQuestions.get(requestId) ||
      null;
    return { targetId: item?.id || mappedId, item };
  }

  async replyQuestion(requestId, answers = [], { reject = false } = {}) {
    let { targetId, item } = this._resolveQuestionTarget(requestId);
    if (!item) {
      return { ok: false, error: "La pregunta ya fue respondida o expiró." };
    }

    const normalizedAnswers = (Array.isArray(answers) ? answers : [answers]).map(
      (group) =>
        (Array.isArray(group) ? group : [group])
          .map((v) => String(v || "").trim())
          .filter(Boolean),
    );
    const flatAnswers = normalizedAnswers.flat();
    if (!reject && flatAnswers.length === 0) {
      return { ok: false, error: "Selecciona una opción o escribe una respuesta." };
    }

    const baseUrl = this.getActiveBaseUrl();
    const caps =
      this.capabilities || (await this._discoverOpenApiCapabilities(baseUrl));
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...this._buildAuthHeaders(),
    };

    const flatText = flatAnswers.join(", ");
    const answersObject = Object.fromEntries(
      (item.questions || []).map((q, idx) => [
        q?.id || q?.header || q?.question || `q_${idx + 1}`,
        (normalizedAnswers[idx] || []).join(", "),
      ]),
    );

    const finalizeQuestionReply = (
      endpoint,
      { appendPromptLog = true, persistDismiss = false } = {},
    ) => {
      if (persistDismiss) {
        this._markQuestionDismissed(item, [requestId, targetId]);
      }
      this._removePendingQuestion(targetId);
      this._removePendingQuestion(requestId);
      if (item.agentId || item.sessionID) {
        this.markAgentThreadViewed(item.agentId, item.sessionID);
      }
      if (item.sessionID) {
        this._markQuestionToolEntryDone(item.sessionID, item.callID);
        if (appendPromptLog) {
          this._appendSessionLogEntry(item.sessionID, {
            kind: "prompt",
            agentId: item.agentId,
            content: reject
              ? `Pregunta omitida (${item.header})`
              : `Respuesta (${item.header}): ${flatText}`,
            status: "done",
          });
        }
      }
      this._emitLiveKanbanSync({
        sessionId: item.sessionID,
        agentId: item.agentId,
        status: reject ? "done" : "in_progress",
        title: reject ? "Pregunta omitida" : "Respuesta enviada",
        file: item.header,
      });
      this._queueAgentTask(
        item.agentId,
        {
          status: reject ? "passed" : "started",
          phase: "working",
          label: reject ? "Pregunta omitida" : "Continuando tarea",
          file: item.header,
        },
        { immediate: true },
      );
      return { ok: true, rejected: reject, endpoint };
    };

    const followUpText = reject
      ? `Omitir pregunta (${item.header || "question"}): continúa aplicando la opción recomendada.`
      : (item.questions || []).length > 1
        ? (item.questions || [])
            .map((q, idx) => {
              const chosen = (normalizedAnswers[idx] || []).join(", ");
              return `${q?.header || q?.question || `Pregunta ${idx + 1}`}: ${chosen}`;
            })
            .join("\n")
        : flatText;

    const hasRestReplyEndpoints = reject
      ? (caps.questionRejectPaths?.length || 0) > 0 ||
        (caps.formRejectPaths?.length || 0) > 0 ||
        (caps.questionReplyPaths?.length || 0) > 0 ||
        (caps.formReplyPaths?.length || 0) > 0
      : (caps.questionReplyPaths?.length || 0) > 0 ||
        (caps.formReplyPaths?.length || 0) > 0;

    // Si /openapi.json confirmó que el servidor NO expone endpoint reply de question ni form,
    // cerrar el banner de inmediato, persistir el descarte y enviar la opción elegida como prompt.
    if (caps.discoveredFrom !== "defaults" && !hasRestReplyEndpoints) {
      if (reject) {
        const dismissed = finalizeQuestionReply("local-omit", {
          appendPromptLog: false,
          persistDismiss: true,
        });
        return { ...dismissed, viaLocalDismiss: true };
      }
      const instantDone = finalizeQuestionReply("session-prompt-fallback", {
        appendPromptLog: false,
        persistDismiss: true,
      });
      const promptFallback = await this.sendPrompt({
        sessionId: item.sessionID || this.activeSessionId || null,
        agent: item.agentId || "architect",
        text: followUpText,
      });
      if (!promptFallback?.ok && item.sessionID && promptFallback?.error) {
        this._appendSessionLogEntry(item.sessionID, {
          kind: "error",
          agentId: item.agentId,
          content: promptFallback.error,
          status: "error",
        });
      }
      return {
        ...instantDone,
        endpoint: promptFallback?.endpoint || instantDone.endpoint,
        viaSessionMessage: true,
        promptOk: Boolean(promptFallback?.ok),
      };
    }

    // Si aún teníamos un placeholder sintético (callID) en lugar del requestID real (que_... / formID),
    // sincronizar primero GET /question y /form para enlazar el ID real si el backend lo expone.
    if (item.isSynthetic) {
      await this.syncPendingQuestions(item.sessionID, undefined, { force: true }).catch(() => []);
      const refreshed = this._resolveQuestionTarget(requestId);
      if (refreshed.item) {
        targetId = refreshed.targetId;
        item = refreshed.item;
      }
      if (item.isSynthetic) {
        const realFallback = Array.from(this.pendingQuestions.values()).find(
          (q) =>
            !q.isSynthetic &&
            q.sessionID === item.sessionID &&
            q.questions?.[0]?.question === item.questions?.[0]?.question,
        );
        if (realFallback) {
          targetId = realFallback.id;
          item = realFallback;
        }
      }
    }

    let lastHttpError = null;

    const sendWithId = async (effectiveId) => {
      if (reject) {
        const rejectTemplates = [
          ...new Set([
            ...(caps.questionRejectPaths || []),
            ...(caps.formRejectPaths || []),
          ]),
        ];
        for (const template of rejectTemplates) {
          if (template.includes("{sessionID}") && !item.sessionID) continue;
          const path = this._fillEndpointTemplate(template, {
            sessionID: item.sessionID || "",
            requestID: item.requestID || effectiveId,
            questionID: item.requestID || effectiveId,
            formID: item.formID || effectiveId,
          });
          const rejectSchemaInfo =
            caps.questionRejectSchemas?.[template] ||
            caps.formRejectSchemas?.[template] ||
            null;
          const rejectBodies = rejectSchemaInfo?.schema
            ? this._buildReplyBodiesFromSchema(rejectSchemaInfo, {
                effectiveId,
                item,
                normalizedAnswers,
                flatAnswers,
                flatText,
                answersObject,
                reject: true,
              })
            : [];
          const bodyText = JSON.stringify(rejectBodies[0] || {});
          try {
            const resp = await fetch(`${baseUrl}${path}`, {
              method: "POST",
              headers,
              body: bodyText,
              signal: AbortSignal.timeout(5000),
            });
            if (resp.status === 404 || resp.status === 405) continue;
            if (!resp.ok) {
              lastHttpError = await this._extractHttpError(
                resp,
                `HTTP ${resp.status} al omitir pregunta`,
              );
              continue;
            }
            return finalizeQuestionReply(path, {
              appendPromptLog: false,
              persistDismiss: true,
            });
          } catch (err) {
            lastHttpError = err?.message || "No se pudo omitir la pregunta";
          }
        }
      }

      const replyTemplates = [
        ...new Set([
          ...(caps.questionReplyPaths || []),
          ...(caps.formReplyPaths || []),
        ]),
      ];

      for (const template of replyTemplates) {
        if (template.includes("{sessionID}") && !item.sessionID) continue;
        const path = this._fillEndpointTemplate(template, {
          sessionID: item.sessionID || "",
          requestID: item.requestID || effectiveId,
          questionID: item.requestID || effectiveId,
          formID: item.formID || effectiveId,
        });

        const schemaInfo =
          caps.questionReplySchemas?.[template] ||
          caps.formReplySchemas?.[template] ||
          null;
        const schemaProps = schemaInfo?.props || [];
        const isFormEndpoint = /\/form/i.test(template);

        let bodyCandidates = [];
        if (schemaInfo?.schema) {
          bodyCandidates = this._buildReplyBodiesFromSchema(schemaInfo, {
            effectiveId,
            item,
            normalizedAnswers,
            flatAnswers,
            flatText,
            answersObject,
            reject,
          });
          // En reject sobre /reply, si el esquema OpenAPI no declara cancel/reject, no spammear 400
          if (reject && bodyCandidates.length === 0) {
            continue;
          }
        }

        if (bodyCandidates.length === 0 && !reject) {
          bodyCandidates = schemaProps.includes("answers")
            ? [{ answers: normalizedAnswers }, { answers: answersObject }, { answers: flatAnswers }]
            : schemaProps.includes("answer")
              ? [{ answer: flatText }, { answers: normalizedAnswers }]
              : schemaProps.includes("values")
                ? [{ values: answersObject }, { values: flatAnswers }, { answers: normalizedAnswers }]
                : schemaProps.includes("data")
                  ? [{ data: answersObject }, { data: { answers: normalizedAnswers } }]
                  : schemaProps.includes("responses")
                    ? [{ responses: normalizedAnswers }, { responses: answersObject }]
                    : isFormEndpoint
                      ? [
                          { answers: answersObject },
                          { answers: normalizedAnswers },
                          { values: answersObject },
                          { data: answersObject },
                        ]
                      : [
                          { answers: normalizedAnswers },
                          { answer: flatText },
                          { values: flatAnswers },
                          { data: answersObject },
                        ];
        } else if (bodyCandidates.length === 0 && reject && !schemaInfo?.schema) {
          bodyCandidates = [{ reject: true }, { decision: "reject" }, { cancelled: true }];
        }

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
              lastHttpError = await this._extractHttpError(
                resp,
                `HTTP ${resp.status} al responder pregunta`,
              );
              continue;
            }
            if (!resp.ok) {
              lastHttpError = await this._extractHttpError(
                resp,
                `Error HTTP ${resp.status} al responder pregunta`,
              );
              break;
            }

            return finalizeQuestionReply(path, {
              appendPromptLog: true,
              persistDismiss: true,
            });
          } catch (err) {
            lastHttpError = err?.message || "No se pudo responder la pregunta";
            break;
          }
        }
      }
      return null;
    };

    const firstAttempt = await sendWithId(targetId);
    if (firstAttempt) return firstAttempt;

    // Si devolvió 404 por desfase de IDs (excepto en reject sin endpoint), intentar sincronizar una vez más
    if (!reject || hasRestReplyEndpoints) {
      await this.syncPendingQuestions(item.sessionID, undefined, { force: true }).catch(() => []);
      const retriedTarget = this._resolveQuestionTarget(requestId);
      const retryMatch =
        (retriedTarget.item && retriedTarget.targetId !== targetId && retriedTarget.item) ||
        Array.from(this.pendingQuestions.values()).find(
          (q) =>
            !q.isSynthetic &&
            q.id !== targetId &&
            q.sessionID === item.sessionID &&
            q.questions?.[0]?.question === item.questions?.[0]?.question,
        );
      if (retryMatch) {
        targetId = retryMatch.id;
        item = retryMatch;
        const secondAttempt = await sendWithId(targetId);
        if (secondAttempt) return secondAttempt;
      }
    }

    // Respaldo final: marcar descartada en localStorage (para que no reaparezca), cerrar el banner
    // y enviar la respuesta elegida como prompt de texto normal.
    if (reject) {
      const doneRes = finalizeQuestionReply("local-omit", {
        appendPromptLog: false,
        persistDismiss: true,
      });
      return { ...doneRes, viaLocalDismiss: true };
    }

    const doneRes = finalizeQuestionReply("session-prompt-fallback", {
      appendPromptLog: false,
      persistDismiss: true,
    });
    const promptFallback = await this.sendPrompt({
      sessionId: item.sessionID || this.activeSessionId || null,
      agent: item.agentId || "architect",
      text: followUpText,
    });
    if (!promptFallback?.ok && item.sessionID && (lastHttpError || promptFallback?.error)) {
      this._appendSessionLogEntry(item.sessionID, {
        kind: "error",
        agentId: item.agentId,
        content: promptFallback?.error || lastHttpError,
        status: "error",
      });
    }
    return {
      ...doneRes,
      endpoint: promptFallback?.endpoint || doneRes.endpoint,
      viaSessionMessage: true,
      promptOk: Boolean(promptFallback?.ok),
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
        const raw = await probe.resp.json().catch(() => []);
        const data = this._unwrapResponseData(raw);
        const list = Array.isArray(data) ? data : data?.sessions || [];
        for (const s of list) this._upsertSessionRecord(s);
      }

      const caps = await this._discoverOpenApiCapabilities(baseUrl, signal);

      if (caps.activeSessionPath) {
        const activeResp = await fetch(`${baseUrl}${caps.activeSessionPath}`, {
          headers,
          signal,
        }).catch(() => null);
        const activeCt = (activeResp?.headers?.get("content-type") || "").toLowerCase();
        if (activeResp?.ok && activeCt.includes("application/json")) {
          const activeRaw = await activeResp.json().catch(() => null);
          const activeSession = this._unwrapResponseData(activeRaw);
          if (activeSession?.id) {
            this._upsertSessionRecord(activeSession);
            if (activeSession.status?.type === "busy") {
              this.activeSessionId = activeSession.id;
            }
          }
        }
      }

      if (caps.sessionStatusPath) {
        const statusResp = await fetch(`${baseUrl}${caps.sessionStatusPath}`, {
          headers,
          signal,
        }).catch(() => null);

        const statusCt = (statusResp?.headers?.get("content-type") || "").toLowerCase();
        if (statusResp?.ok && statusCt.includes("application/json")) {
          const statusRaw = await statusResp.json().catch(() => ({}));
          const statusMap = this._unwrapResponseData(statusRaw);
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
      }

      // Sincronizar permisos/preguntas activos en raíz y subsesiones hijas sin hidratar chats viejos completos
      await Promise.all([
        this.activeSessionId
          ? this.syncSessionPermissions(this.activeSessionId, signal).catch(() => [])
          : Promise.resolve([]),
        this.syncAllActiveSessionsQuestions(signal).catch(() => []),
      ]);
      this._emitConnectionState();
    } catch (err) {
      if (err?.message?.includes("401")) throw err;
      // No bloquear apertura SSE si alguna ruta auxiliar difiere según versión
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
      this.spatialBridgeBackoffUntil = 0;
      this._startSpatialPolling();
      if (this.lastSpatialSnapshot) {
        this.syncSpatialState(this.lastSpatialSnapshot, { force: true });
      }

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
    for (const item of this.pendingQuestions.values()) {
      this._emitLiveKanbanSync({
        sessionId: item.sessionID,
        agentId: item.agentId,
        status: "done",
        title: "Puente desconectado",
        file: item.header || "question",
      });
    }
    this.activeAgents.clear();
    this.sessionsById.clear();
    this.activeSessionId = null;
    this.sessionAgentMap.clear();
    this.busySessions.clear();
    this.pendingPermissions.clear();
    this.pendingQuestions.clear();
    this.pendingInquiries.clear();
    this.agentPreferredSessionMap.clear();
    this.questionCallIdMap.clear();
    this.questionSyncInFlight.clear();
    this.questionSyncLastAt.clear();
    this.liveTaskMeta.clear();
    this.taskCallsByChildSession.clear();
    this.taskCallsByPartId.clear();
    this.sessionLogsById.clear();
    this.sessionHistoryState.clear();
    this.historyFetchPromises.clear();
    this.childSessionsByParent.clear();
    this.messageMetaById.clear();
    this.reasoningBuffers.clear();
    this.activeStreamEntryIds.clear();
    this.emittedDelegations.clear();
    this.capabilities = null;
    this.capabilitiesCache.clear();
    this.deadGetPaths.clear();
    this.status = "disconnected";
    this.lastError = null;
    officeEventBus.emit(
      OFFICE_EVENTS.OPENCODE_SESSION_LOG,
      { sessionId: null, entries: [], cleared: true },
      "opencode-sse",
    );
    this._emitQuestionsState(false, null);
    this._emitPermissionsState(false, null);
  }

  _getSpatialBridgeUrl() {
    if (this.config.mode === "bridge" && this.config.bridgeUrl) {
      return this.config.bridgeUrl.replace(/\/+$/, "");
    }
    return (this.config.bridgeUrl || "http://127.0.0.1:4097").replace(/\/+$/, "");
  }

  _syncWhiteboardFromBridge(notes) {
    if (!Array.isArray(notes)) return;
    const sig = notes.map((n) => `${n.id}:${n.createdAt || 0}`).join("|");
    if (sig === this.lastWhiteboardSig) return;
    this.lastWhiteboardSig = sig;
    officeEventBus.emit(
      OFFICE_EVENTS.OFFICE_WHITEBOARD_UPDATED,
      { notes },
      "spatial-bridge",
    );
  }

  _startSpatialPolling() {
    if (this.spatialPollTimer || typeof window === "undefined") return;
    this.spatialPollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      this.pollSpatialCommands();
    }, 1500);
  }

  _stopSpatialPolling() {
    if (this.spatialPollTimer) {
      clearInterval(this.spatialPollTimer);
      this.spatialPollTimer = null;
    }
  }

  async syncSpatialState(snapshot, { force = false } = {}) {
    if (!snapshot || typeof snapshot !== "object") return;
    this.lastSpatialSnapshot = snapshot;

    const now = Date.now();
    if (!force && now < this.spatialBridgeBackoffUntil) return;
    if (this.spatialSyncInFlight) return;

    const bridgeUrl = this._getSpatialBridgeUrl();
    if (!bridgeUrl) return;

    this.spatialSyncInFlight = true;
    try {
      const resp = await fetch(`${bridgeUrl}/api/office/spatial-state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(2000),
      });
      if (!resp.ok) {
        this.spatialBridgeBackoffUntil = Date.now() + 15000;
        return;
      }
      this.spatialBridgeBackoffUntil = 0;
      const data = await resp.json().catch(() => null);
      if (Array.isArray(data?.whiteboard?.notes)) {
        this._syncWhiteboardFromBridge(data.whiteboard.notes);
      }
      if (Number(data?.pendingCommandsCount) > 0) {
        this.pollSpatialCommands({ force: true });
      }
    } catch {
      this.spatialBridgeBackoffUntil = Date.now() + 15000;
    } finally {
      this.spatialSyncInFlight = false;
    }
  }

  async pollSpatialCommands({ force = false } = {}) {
    const now = Date.now();
    if (!force && now < this.spatialBridgeBackoffUntil) return;
    if (this.spatialPollInFlight) return;

    const bridgeUrl = this._getSpatialBridgeUrl();
    if (!bridgeUrl) return;

    this.spatialPollInFlight = true;
    try {
      const resp = await fetch(`${bridgeUrl}/api/office/spatial-command`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2000),
      });
      if (!resp.ok) {
        this.spatialBridgeBackoffUntil = Date.now() + 15000;
        return;
      }
      this.spatialBridgeBackoffUntil = 0;
      const data = await resp.json().catch(() => null);
      if (Array.isArray(data?.whiteboard?.notes)) {
        this._syncWhiteboardFromBridge(data.whiteboard.notes);
      }
      const commands = Array.isArray(data?.commands) ? data.commands : [];
      for (const cmd of commands) {
        if (cmd && cmd.type) {
          officeEventBus.emit(OFFICE_EVENTS.OFFICE_SPATIAL_COMMAND, cmd, "spatial-bridge");
        }
      }
    } catch {
      this.spatialBridgeBackoffUntil = Date.now() + 15000;
    } finally {
      this.spatialPollInFlight = false;
    }
  }

  dispose() {
    this._stopSpatialPolling();
    if (this.spatialUnsub) {
      this.spatialUnsub();
      this.spatialUnsub = null;
    }
    this.disconnect();
  }
}

export const openCodeBridge = new OpenCodeBridgeClient();
