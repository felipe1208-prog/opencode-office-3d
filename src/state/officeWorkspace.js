import { AGENT_STATIONS } from "../config/officeLayout.js";
import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";

const PROFILE_STORAGE_KEY = "oficina3d:agent_profiles:v1";
const TASK_STORAGE_KEY = "oficina3d:task_board:v1";

export const AGENT_COLOR_PALETTE = [
  { name: "Violeta", hex: "#8B5CF6" },
  { name: "Ámbar", hex: "#EAB308" },
  { name: "Púrpura", hex: "#9333EA" },
  { name: "Azul Cielo", hex: "#0284C7" },
  { name: "Naranja", hex: "#EA580C" },
  { name: "Esmeralda", hex: "#10B981" },
  { name: "Rosa", hex: "#EC4899" },
  { name: "Cian", hex: "#06B6D4" },
];

export const TASK_COLUMNS = [
  { id: "todo", label: "Pendiente", accent: "text-slate-300" },
  { id: "in_progress", label: "En Curso", accent: "text-sky-300" },
  { id: "review", label: "En Revisión", accent: "text-violet-300" },
  { id: "done", label: "Completada", accent: "text-emerald-300" },
  { id: "blocked", label: "Bloqueada", accent: "text-rose-300" },
];

const DEFAULT_TASK_IDS = new Set([
  "t-arch-1",
  "t-front-1",
  "t-qa-1",
  "t-back-1",
  "t-sys-1",
]);

const DEFAULT_TASKS = [
  {
    id: "t-arch-1",
    title: "Validar contrato Event Bus",
    file: "src/events/OfficeEventBus.js",
    assigneeId: "architect",
    status: "in_progress",
    source: "demo",
    updatedAt: Date.now() - 180000,
  },
  {
    id: "t-front-1",
    title: "Calibrar reflejos PBR",
    file: "src/webgl/Experience.js",
    assigneeId: "frontend",
    status: "in_progress",
    source: "demo",
    updatedAt: Date.now() - 140000,
  },
  {
    id: "t-qa-1",
    title: "Auditar 52 checkpoints A*",
    file: "tests/nav-integrity.spec.ts",
    assigneeId: "qa",
    status: "done",
    source: "demo",
    updatedAt: Date.now() - 100000,
  },
  {
    id: "t-back-1",
    title: "Sincronizar colas de espera",
    file: "src/webgl/interaction/CheckpointManager.js",
    assigneeId: "backend",
    status: "todo",
    source: "demo",
    updatedAt: Date.now() - 75000,
  },
  {
    id: "t-sys-1",
    title: "Preparar hook CLI futuro",
    file: "cli/opencode-adapter.ts",
    assigneeId: "systems",
    status: "review",
    source: "demo",
    updatedAt: Date.now() - 40000,
  },
];

function safeReadStorage(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteStorage(key, value) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignorar errores de cuota o entorno sin almacenamiento
  }
}

export class AgentProfileManager {
  constructor() {
    this.defaults = Object.fromEntries(
      Object.entries(AGENT_STATIONS).map(([id, st]) => [
        id,
        {
          id: st.id,
          name: st.name,
          role: st.role,
          color: st.color,
          checkpointId: st.checkpointId,
          directory: st.directory,
        },
      ]),
    );
    this.profiles = this._load();
  }

  _load() {
    const saved = safeReadStorage(PROFILE_STORAGE_KEY);
    const result = {};
    for (const [id, def] of Object.entries(this.defaults)) {
      const custom = saved && saved[id] ? saved[id] : {};
      result[id] = {
        ...def,
        name: typeof custom.name === "string" && custom.name.trim()
          ? custom.name.trim().slice(0, 20)
          : def.name,
        role: typeof custom.role === "string" && custom.role.trim()
          ? custom.role.trim().slice(0, 28)
          : def.role,
        color:
          typeof custom.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(custom.color)
            ? custom.color
            : def.color,
      };
    }
    return result;
  }

  _save() {
    const overrides = {};
    for (const [id, prof] of Object.entries(this.profiles)) {
      overrides[id] = {
        name: prof.name,
        role: prof.role,
        color: prof.color,
      };
    }
    safeWriteStorage(PROFILE_STORAGE_KEY, overrides);
  }

  getProfiles() {
    return Object.values(this.profiles).map((p) => ({ ...p }));
  }

  getProfile(agentId) {
    return this.profiles[agentId] ? { ...this.profiles[agentId] } : null;
  }

  updateProfile(agentId, { name, role, color } = {}) {
    const current = this.profiles[agentId];
    if (!current) return null;

    if (typeof name === "string" && name.trim()) {
      current.name = name.trim().slice(0, 20);
    }
    if (typeof role === "string" && role.trim()) {
      current.role = role.trim().slice(0, 28);
    }
    if (typeof color === "string" && /^#[0-9A-Fa-f]{6}$/.test(color)) {
      current.color = color;
    }

    this._save();

    const updated = { ...current };
    officeEventBus.emit(
      OFFICE_EVENTS.AGENT_PROFILE_UPDATED,
      { agentId, profile: updated },
      "profile-store",
    );
    return updated;
  }

  resetProfiles() {
    for (const [id, def] of Object.entries(this.defaults)) {
      this.profiles[id] = { ...def };
      officeEventBus.emit(
        OFFICE_EVENTS.AGENT_PROFILE_UPDATED,
        { agentId: id, profile: { ...def } },
        "profile-reset",
      );
    }
    this._save();
    return this.getProfiles();
  }
}

export class TaskBoardManager {
  constructor() {
    this.tasks = this._load();
    this.seq = Date.now();
    this._bindOpenCodeSync();
  }

  _bindOpenCodeSync() {
    officeEventBus.on(OFFICE_EVENTS.OPENCODE_TASK_SYNC, (payload) => {
      if (!payload || !payload.externalKey) return;
      this.upsertLiveTask(payload);
    });
  }

  _load() {
    const saved = safeReadStorage(TASK_STORAGE_KEY);
    if (Array.isArray(saved)) {
      return saved.map((t) => ({
        ...t,
        source:
          t.source ||
          (t.externalKey
            ? "opencode"
            : DEFAULT_TASK_IDS.has(t.id)
              ? "demo"
              : "manual"),
      }));
    }
    return DEFAULT_TASKS.map((t) => ({ ...t }));
  }

  _save() {
    safeWriteStorage(TASK_STORAGE_KEY, this.tasks);
  }

  getTasks() {
    return this.tasks.map((t) => ({ ...t }));
  }

  addTask({
    title,
    file = "",
    assigneeId = "frontend",
    status = "todo",
    source = "manual",
  } = {}) {
    const cleanTitle = String(title || "").trim().slice(0, 56);
    if (!cleanTitle) return null;

    const validStatus = TASK_COLUMNS.some((c) => c.id === status)
      ? status
      : "todo";

    const task = {
      id: `t-${++this.seq}`,
      title: cleanTitle,
      file: String(file || "").trim().slice(0, 48) || "src/workspace/task.ts",
      assigneeId,
      status: validStatus,
      source: source === "opencode" || source === "demo" ? source : "manual",
      updatedAt: Date.now(),
    };

    this.tasks.unshift(task);
    this._save();
    this._dispatchTaskEvent(task, "task-board");
    return { ...task };
  }

  upsertLiveTask({
    externalKey,
    sessionId = null,
    assigneeId = "architect",
    title = "",
    file = null,
    status = "in_progress",
  } = {}) {
    if (!externalKey) return null;

    const validStatus = TASK_COLUMNS.some((c) => c.id === status)
      ? status
      : "in_progress";
    const cleanTitle = String(title || "").trim().slice(0, 56);
    const cleanFile = file ? String(file).trim().slice(0, 48) : null;

    const existing = this.tasks.find((t) => t.externalKey === externalKey);
    if (existing) {
      if (cleanTitle) existing.title = cleanTitle;
      if (cleanFile) existing.file = cleanFile;
      if (assigneeId) existing.assigneeId = assigneeId;
      existing.status = validStatus;
      existing.source = "opencode";
      if (sessionId) existing.sessionId = sessionId;
      existing.updatedAt = Date.now();

      this._save();
      officeEventBus.emit(
        OFFICE_EVENTS.TASK_BOARD_SYNC,
        { action: "live_upsert", task: { ...existing } },
        "opencode-sync",
      );
      return { ...existing };
    }

    const task = {
      id: `oc-${++this.seq}`,
      externalKey,
      sessionId,
      source: "opencode",
      title: cleanTitle || "Ejecutando en OpenCode",
      file: cleanFile || (sessionId ? `ses:${String(sessionId).slice(0, 14)}` : "OpenCode CLI"),
      assigneeId: assigneeId || "architect",
      status: validStatus,
      updatedAt: Date.now(),
    };

    this.tasks.unshift(task);
    this._save();
    officeEventBus.emit(
      OFFICE_EVENTS.TASK_BOARD_SYNC,
      { action: "live_upsert", task: { ...task } },
      "opencode-sync",
    );
    return { ...task };
  }

  moveTask(taskId, newStatus) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return null;
    if (!TASK_COLUMNS.some((c) => c.id === newStatus)) return null;

    task.status = newStatus;
    task.updatedAt = Date.now();
    this._save();
    this._dispatchTaskEvent(task, "task-board");
    return { ...task };
  }

  deleteTask(taskId) {
    const idx = this.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;
    this.tasks.splice(idx, 1);
    this._save();
    officeEventBus.emit(
      OFFICE_EVENTS.TASK_BOARD_SYNC,
      { action: "deleted", taskId },
      "task-board",
    );
    return true;
  }

  clearDoneTasks() {
    this.tasks = this.tasks.filter((t) => t.status !== "done");
    this._save();
    officeEventBus.emit(
      OFFICE_EVENTS.TASK_BOARD_SYNC,
      { action: "cleared_done" },
      "task-board",
    );
    return this.getTasks();
  }

  clearDemoTasks() {
    this.tasks = this.tasks.filter(
      (t) => t.source !== "demo" && !DEFAULT_TASK_IDS.has(t.id),
    );
    this._save();
    officeEventBus.emit(
      OFFICE_EVENTS.TASK_BOARD_SYNC,
      { action: "cleared_demo" },
      "task-board",
    );
    return this.getTasks();
  }

  resetTasks() {
    const liveTasks = this.tasks.filter((t) => t.source === "opencode");
    this.tasks = [
      ...liveTasks,
      ...DEFAULT_TASKS.map((t) => ({ ...t, updatedAt: Date.now() })),
    ];
    this._save();
    officeEventBus.emit(
      OFFICE_EVENTS.TASK_BOARD_SYNC,
      { action: "reset" },
      "task-board",
    );
    return this.getTasks();
  }

  _dispatchTaskEvent(task, source) {
    officeEventBus.emit(
      OFFICE_EVENTS.TASK_BOARD_SYNC,
      { task: { ...task } },
      source,
    );

    if (task.status === "in_progress") {
      officeEventBus.emit(
        OFFICE_EVENTS.AGENT_TASK,
        {
          agentId: task.assigneeId,
          status: "started",
          label: task.title,
          file: task.file,
        },
        source,
      );
    } else if (task.status === "review") {
      officeEventBus.emit(
        OFFICE_EVENTS.SOCIAL_DESK_REVIEW,
        {
          hostAgentId: task.assigneeId,
          topic: task.title,
        },
        source,
      );
    } else if (task.status === "done") {
      officeEventBus.emit(
        OFFICE_EVENTS.AGENT_TASK,
        {
          agentId: task.assigneeId,
          status: "passed",
          label: task.title,
          file: task.file,
        },
        source,
      );
    } else if (task.status === "blocked") {
      officeEventBus.emit(
        OFFICE_EVENTS.AGENT_TASK,
        {
          agentId: task.assigneeId,
          status: "failed",
          label: task.title,
          file: task.file,
        },
        source,
      );
    }
  }
}

export const agentProfileManager = new AgentProfileManager();
export const taskBoardManager = new TaskBoardManager();
