<script setup>
import {
  onMounted,
  ref,
  reactive,
  computed,
  watch,
  nextTick,
  onBeforeUnmount,
} from "vue";
import {
  Sun,
  Moon,
  RefreshCw,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Crosshair,
  X,
  RotateCcw,
  Users,
  Gamepad2,
  MessageSquare,
  GitPullRequest,
  Radio,
  ListTodo,
  UserCog,
  Volume2,
  VolumeX,
  Plus,
  Trash2,
  Terminal,
  Copy,
  Check,
  Plug,
  Download,
  Send,
  Square,
  ShieldAlert,
  AlertTriangle,
} from "@lucide/vue";
import { Resources } from "./webgl/core/Resources";
import { Experience } from "./webgl/Experience";
import { ASSETS_MANIFEST } from "./config/assets";
import { AGENT_STATIONS } from "./config/officeLayout";
import { officeEventBus, OFFICE_EVENTS } from "./events/OfficeEventBus";
import {
  agentProfileManager,
  taskBoardManager,
  AGENT_COLOR_PALETTE,
  TASK_COLUMNS,
} from "./state/officeWorkspace";
import { ambientAudio } from "./audio/AmbientAudioEngine";
import { openCodeBridge } from "./opencode/OpenCodeBridgeClient";
import {
  OPENCODE_JSON_SNIPPET,
  OPENCODE_CLI_COMMANDS,
  buildOpenCodeSetupReport,
} from "./opencode/openCodeTemplates";
import { renderSafeMarkdown } from "./utils/safeMarkdown";

const canvasRef = ref(null);
const loadProgress = ref(0);
const isReady = ref(false);
const selectedAgentId = ref(null);
const timeMode = ref("day"); // 'day' | 'night' | 'auto'
const isDockCollapsed = ref(false);
const showBubbles = ref(true);
const isTaskBoardOpen = ref(false);
const isOpenCodePanelOpen = ref(false);
const openCodeTab = ref("connection"); // 'command' | 'connection' | 'mapping' | 'guide'
const activeInspectorTab = ref("routes"); // 'routes' | 'animations' | 'events' | 'profile'
const eventLog = ref([]);

const profiles = ref(agentProfileManager.getProfiles());
const tasks = ref(taskBoardManager.getTasks());
const taskSourceFilter = ref("all"); // 'all' | 'opencode' | 'manual'
const audioEnabled = ref(false);
const audioVolume = ref(0.45);
const dismissedBlockedAlertKeys = ref(new Set());

const initialOpenCodeCfg = openCodeBridge.getConfig();
const openCodeState = ref(openCodeBridge.getSnapshot());
const openCodeForm = reactive({
  mode: initialOpenCodeCfg.mode,
  directUrl: initialOpenCodeCfg.directUrl,
  bridgeUrl: initialOpenCodeCfg.bridgeUrl,
  username: initialOpenCodeCfg.username,
  password: initialOpenCodeCfg.password,
  idleCooldownSec: initialOpenCodeCfg.idleCooldownSec,
  autoReconnect: initialOpenCodeCfg.autoReconnect,
});
const aliasDraft = reactive(
  Object.fromEntries(
    Object.entries(initialOpenCodeCfg.aliases).map(([id, list]) => [
      id,
      list.join(", "),
    ]),
  ),
);
const testResult = ref(null);
const isTestingConnection = ref(false);
const copiedKey = ref(null);

const commandForm = reactive({
  sessionId: openCodeState.value.activeSessionId || "",
  agent: "architect",
  prompt: "",
});
const isSendingPrompt = ref(false);
const isCreatingSession = ref(false);
const isInterrupting = ref(false);
const commandFeedback = ref(null);
const replyingPermissionId = ref(null);
const permissionError = ref(null);
const replyingQuestionId = ref(null);
const questionError = ref(null);
const questionDrafts = reactive({});
const sessionLogEntries = ref([]);
const childSessionLogs = reactive({});
const logContainerRef = ref(null);

const newTask = reactive({
  title: "",
  file: "",
  assigneeId: "frontend",
  status: "in_progress",
});

const profileDraft = reactive({
  name: "",
  role: "",
  color: "#8B5CF6",
});

const directorState = reactive({
  paused: false,
  speedMultiplier: 1,
});

const agentSnapshots = reactive({});

const agentList = computed(() => profiles.value);

const profileMap = computed(() =>
  Object.fromEntries(profiles.value.map((p) => [p.id, p])),
);

const filteredTasks = computed(() => {
  if (taskSourceFilter.value === "opencode") {
    return tasks.value.filter((t) => t.source === "opencode");
  }
  if (taskSourceFilter.value === "manual") {
    return tasks.value.filter((t) => t.source !== "opencode");
  }
  return tasks.value;
});

const demoTasksCount = computed(
  () => tasks.value.filter((t) => t.source === "demo").length,
);

const activePermission = computed(
  () => openCodeState.value.pendingPermissions?.[0] || null,
);

const activeQuestion = computed(
  () => openCodeState.value.pendingQuestions?.[0] || null,
);

const blockedCliAlerts = computed(() => {
  const permSessions = new Set(
    (openCodeState.value.pendingPermissions || [])
      .map((p) => p.sessionID)
      .filter(Boolean),
  );
  const questionSessions = new Set(
    (openCodeState.value.pendingQuestions || [])
      .map((q) => q.sessionID)
      .filter(Boolean),
  );
  return tasks.value
    .filter(
      (t) =>
        t.source === "opencode" &&
        t.status === "blocked" &&
        !permSessions.has(t.sessionId) &&
        !questionSessions.has(t.sessionId) &&
        !dismissedBlockedAlertKeys.value.has(`${t.id}:${t.updatedAt}`),
    )
    .slice(0, 2);
});

const activeLogSessionId = computed(
  () => commandForm.sessionId || openCodeState.value.activeSessionId || "",
);

const activeHistoryState = computed(() => {
  const sid = activeLogSessionId.value;
  if (!sid) return { status: "idle", error: null, lastSyncedAt: null };
  return (
    openCodeState.value.sessionHistoryStates?.[sid] || {
      status: "idle",
      error: null,
      lastSyncedAt: null,
    }
  );
});

const unlinkedChildSessions = computed(() => {
  const sid = activeLogSessionId.value;
  if (!sid) return [];
  const childIds = openCodeState.value.childSessionsByParent?.[sid] || [];
  if (childIds.length === 0) return [];
  const linked = new Set(
    sessionLogEntries.value.map((e) => e.childSessionId).filter(Boolean),
  );
  return childIds
    .filter((cid) => !linked.has(cid))
    .map((cid) => {
      const sess = (openCodeState.value.sessions || []).find((s) => s.id === cid);
      return {
        id: cid,
        title: sess?.title || `Sub-sesión ${cid.slice(0, 10)}`,
        agentId: sess?.agent || null,
      };
    });
});

const taskCountByStatus = computed(() => {
  const counts = {};
  for (const col of TASK_COLUMNS) counts[col.id] = 0;
  for (const t of filteredTasks.value) {
    if (counts[t.status] !== undefined) counts[t.status] += 1;
  }
  return counts;
});

const selectedSnapshot = computed(() => {
  if (!selectedAgentId.value) return null;
  const liveProfile = profileMap.value[selectedAgentId.value];
  const fallback = liveProfile || AGENT_STATIONS[selectedAgentId.value];
  const snap = agentSnapshots[selectedAgentId.value];
  if (snap) {
    return {
      ...snap,
      name: liveProfile?.name || snap.name,
      role: liveProfile?.role || snap.role,
      color: liveProfile?.color || snap.color,
    };
  }
  return fallback
    ? {
        id: fallback.id,
        name: fallback.name,
        role: fallback.role,
        color: fallback.color,
        directory: fallback.directory,
        state: "WORKING",
        animation: "typing",
        actionLabel: "Tecleando código",
        prop: "Ninguno",
        zone: "dev-area",
        checkpointId: fallback.checkpointId,
      }
    : null;
});

const ROUTE_TRIGGERS = [
  { label: "Ir a Café", checkpointId: "kitchen-espresso", action: "makeCoffee" },
  {
    label: "Ir a Agua",
    checkpointId: "kitchen-water-cooler",
    action: "drinkWater",
  },
  { label: "Ir a Nevera", checkpointId: "kitchen-fridge", action: "openFridge" },
  { label: "Barra Café", checkpointId: "barstool-1", action: "drinkCoffee" },
  { label: "Ir a Lounge", checkpointId: "lounge-sofa-s1", action: "watchTV" },
  {
    label: "Ir a Pizarra",
    checkpointId: "pingpong-whiteboard",
    action: "viewTournament",
  },
  { label: "Ir a Arcade", checkpointId: "arcade-machine", action: "playArcade" },
  {
    label: "Sala Reuniones",
    checkpointId: "meeting-presenter",
    action: "presenting",
  },
  {
    label: "Despacho Archivo",
    checkpointId: "supervisor-bookcase",
    action: "browseBooks",
  },
];

const ANIMATION_TRIGGERS = [
  { label: "Teclear", action: "typing" },
  { label: "Festejo", action: "sittingCheer" },
  { label: "Incredulidad", action: "sittingDisbelief" },
  { label: "Hablando Sentado", action: "sittingTalking" },
  { label: "Bebiendo", action: "drinking" },
  { label: "Texting Móvil", action: "texting" },
  { label: "Botones", action: "buttonPushing" },
  { label: "Señalando", action: "pointing" },
  { label: "Hablando Pie", action: "talking" },
  { label: "Giro 180°", action: "walkingTurn180" },
  { label: "Reposo Sentado", action: "sittingIdle" },
  { label: "Reposo Pie", action: "standingIdle" },
];

const BUS_TEST_ACTIONS = [
  {
    label: "Tarea: Compilando",
    type: OFFICE_EVENTS.AGENT_TASK,
    buildPayload: (id) => ({
      agentId: id,
      status: "started",
      label: "Compilando módulo",
      file: "src/core/pipeline.ts",
    }),
  },
  {
    label: "Tarea: Build OK",
    type: OFFICE_EVENTS.AGENT_TASK,
    buildPayload: (id) => ({
      agentId: id,
      status: "passed",
      label: "Suite verde (47/47)",
      file: "tests/office.spec.ts",
    }),
  },
  {
    label: "Tarea: Fallo Test",
    type: OFFICE_EVENTS.AGENT_TASK,
    buildPayload: (id) => ({
      agentId: id,
      status: "failed",
      label: "Revisando fallo API",
      file: "src/events/bus.ts",
    }),
  },
  {
    label: "Charla en Café",
    type: "custom:pair_chat",
  },
  {
    label: "Pedir Revisión",
    type: "custom:desk_review",
  },
];

let experience = null;
let unsubBusHistory = null;
let unsubProfileSync = null;
let unsubTaskSync = null;
let unsubOpenCode = null;
let unsubSessionLog = null;
let copyFeedbackTimer = null;

function hexToRgba(hex, alpha = 0.12) {
  const clean = String(hex || "#4F6EF7").replace("#", "");
  if (clean.length !== 6) return `rgba(79, 110, 247, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getAgentAvatarStyle(agent) {
  const isSelected = selectedAgentId.value === agent.id;
  const isLive = openCodeState.value.activeAgents.includes(agent.id);
  if (isSelected) {
    return {
      backgroundColor: hexToRgba(agent.color, 0.14),
      borderColor: hexToRgba(agent.color, 0.45),
    };
  }
  if (isLive) {
    return {
      backgroundColor: hexToRgba(agent.color, 0.1),
      borderColor: hexToRgba(agent.color, 0.28),
    };
  }
  return {};
}

function scrollLogToBottom(force = false) {
  const el = logContainerRef.value;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 52;
  if (force || nearBottom) {
    el.scrollTop = el.scrollHeight;
  }
}

function initQuestionDraft(item, prevId = null) {
  if (!item?.id) return null;
  const questions = Array.isArray(item.questions) ? item.questions : [];
  const existing = questionDrafts[item.id];
  if (!Array.isArray(existing) || existing.length !== questions.length) {
    const prevDraft = prevId ? questionDrafts[prevId] : null;
    if (Array.isArray(prevDraft) && prevDraft.length === questions.length) {
      questionDrafts[item.id] = prevDraft.map((slot) => ({
        selected: Array.isArray(slot?.selected) ? [...slot.selected] : [],
        custom: String(slot?.custom || ""),
      }));
    } else {
      questionDrafts[item.id] = questions.map(() => ({
        selected: [],
        custom: "",
      }));
    }
  }
  return questionDrafts[item.id];
}

watch(
  () => [activeQuestion.value?.id, activeQuestion.value?.questions?.length || 0],
  ([newId], [oldId] = []) => {
    const item = activeQuestion.value;
    if (item && newId) {
      initQuestionDraft(item, oldId && oldId !== newId ? oldId : null);
    } else {
      questionError.value = null;
    }
  },
  { immediate: true },
);

function syncChildLogsForEntries(entries = []) {
  for (const entry of entries) {
    if (entry?.childSessionId) {
      childSessionLogs[entry.childSessionId] = openCodeBridge.getSessionLog(
        entry.childSessionId,
      );
    }
  }
}

function syncSessionLogView() {
  const sid = activeLogSessionId.value;
  const entries = sid ? openCodeBridge.getSessionLog(sid) : [];
  sessionLogEntries.value = entries;
  syncChildLogsForEntries(entries);
  const childIds = sid
    ? openCodeState.value.childSessionsByParent?.[sid] || []
    : [];
  for (const cid of childIds) {
    childSessionLogs[cid] = openCodeBridge.getSessionLog(cid);
  }
}

watch(activeLogSessionId, () => {
  syncSessionLogView();
  nextTick(() => scrollLogToBottom(true));
});

function syncProfileDraft(agentId = selectedAgentId.value) {
  if (!agentId) return;
  const p = agentProfileManager.getProfile(agentId);
  if (!p) return;
  profileDraft.name = p.name;
  profileDraft.role = p.role;
  profileDraft.color = p.color;
}

function syncAliasDraft(cfg = openCodeBridge.getConfig()) {
  for (const [id, list] of Object.entries(cfg.aliases)) {
    aliasDraft[id] = list.join(", ");
  }
}

function handleKeyDown(e) {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  if (e.key === "h" || e.key === "H") {
    isDockCollapsed.value = !isDockCollapsed.value;
  } else if (e.key === "Escape") {
    if (isOpenCodePanelOpen.value) {
      isOpenCodePanelOpen.value = false;
    } else if (isTaskBoardOpen.value) {
      isTaskBoardOpen.value = false;
    } else if (selectedAgentId.value) {
      experience?.handleStationSelect(null);
    }
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  unsubBusHistory = officeEventBus.on("*", () => {
    eventLog.value = officeEventBus.getHistory(5);
  });
  unsubProfileSync = officeEventBus.on(
    OFFICE_EVENTS.AGENT_PROFILE_UPDATED,
    () => {
      profiles.value = agentProfileManager.getProfiles();
      syncProfileDraft();
    },
  );
  unsubTaskSync = officeEventBus.on(OFFICE_EVENTS.TASK_BOARD_SYNC, () => {
    tasks.value = taskBoardManager.getTasks();
  });
  unsubOpenCode = officeEventBus.on(OFFICE_EVENTS.OPENCODE_CONNECTION, (snap) => {
    const prevStatus = openCodeState.value.status;
    openCodeState.value = snap;

    const availableIds = new Set((snap.sessions || []).map((s) => s.id));
    if (commandForm.sessionId && !availableIds.has(commandForm.sessionId)) {
      commandForm.sessionId = "";
    }

    if (
      prevStatus !== "connected" &&
      snap.status === "connected" &&
      isOpenCodePanelOpen.value &&
      openCodeTab.value === "connection"
    ) {
      openCodeTab.value = "command";
    }
    if ((snap.pendingPermissions || []).length === 0) {
      permissionError.value = null;
    }
    if ((snap.pendingQuestions || []).length === 0) {
      questionError.value = null;
    }
  });
  unsubSessionLog = officeEventBus.on(
    OFFICE_EVENTS.OPENCODE_SESSION_LOG,
    (payload) => {
      if (payload?.cleared && !payload?.sessionId) {
        sessionLogEntries.value = [];
        for (const key of Object.keys(childSessionLogs)) {
          delete childSessionLogs[key];
        }
        return;
      }
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      if (payload?.sessionId) {
        const parentChildren =
          openCodeState.value.childSessionsByParent?.[activeLogSessionId.value] || [];
        const isTrackedChild =
          Object.prototype.hasOwnProperty.call(childSessionLogs, payload.sessionId) ||
          parentChildren.includes(payload.sessionId) ||
          sessionLogEntries.value.some((e) => e.childSessionId === payload.sessionId);
        if (isTrackedChild) {
          childSessionLogs[payload.sessionId] = entries;
        }
      }
      if (!payload?.sessionId || payload.sessionId === activeLogSessionId.value) {
        const el = logContainerRef.value;
        const shouldAutoScroll =
          !el || el.scrollHeight - el.scrollTop - el.clientHeight < 52;
        sessionLogEntries.value = entries;
        syncChildLogsForEntries(entries);
        if (shouldAutoScroll) {
          nextTick(() => scrollLogToBottom(true));
        }
      }
    },
  );
  syncSessionLogView();
  eventLog.value = officeEventBus.getHistory(5);
  const resources = new Resources(ASSETS_MANIFEST);

  resources.addEventListener("progress", (e) => {
    loadProgress.value = Math.round(e.detail.progress * 100);
  });

  resources.addEventListener("ready", () => {
    isReady.value = true;
    if (canvasRef.value) {
      experience = new Experience(canvasRef.value, resources, {
        onSelect: (agentId) => {
          selectedAgentId.value = agentId;
          syncProfileDraft(agentId);
          if (agentId && isDockCollapsed.value) {
            isDockCollapsed.value = false;
          }
        },
        onAgentUpdate: (agentId, snapshot) => {
          agentSnapshots[agentId] = snapshot;
        },
        onDirectorChange: (state) => {
          directorState.paused = state.paused;
          directorState.speedMultiplier = state.speedMultiplier;
        },
      });

      const initial = experience.getAgentSnapshots();
      Object.entries(initial).forEach(([id, snap]) => {
        agentSnapshots[id] = snap;
      });
    }
  });

  resources.startLoading();
});

function selectAgentFromDock(agentId) {
  if (!experience) return;
  ambientAudio.playSoftTick();
  if (selectedAgentId.value === agentId) {
    experience.focusAgent(agentId);
  } else {
    experience.handleStationSelect(agentId, { focusCamera: true });
  }
}

function sendToRoute(trigger) {
  if (!selectedAgentId.value || !experience) return;
  ambientAudio.playSoftTick();
  experience.sendAgentToCheckpoint(
    selectedAgentId.value,
    trigger.checkpointId,
    trigger.action,
  );
}

function triggerAnimationPreview(actionKey) {
  if (!selectedAgentId.value || !experience) return;
  ambientAudio.playSoftTick();
  experience.forceAgentAnimation(selectedAgentId.value, actionKey);
}

function sendSelectedHome() {
  if (!selectedAgentId.value || !experience) return;
  ambientAudio.playSoftTick();
  experience.sendAgentHome(selectedAgentId.value);
}

function toggleDirectorPause() {
  if (!experience) return;
  experience.setSimulationPaused(!directorState.paused);
}

function toggleDirectorSpeed() {
  if (!experience) return;
  const next =
    directorState.speedMultiplier === 1
      ? 1.5
      : directorState.speedMultiplier === 1.5
        ? 2
        : 1;
  experience.setSimulationSpeed(next);
}

function setLightingMode(mode) {
  timeMode.value = mode;
  if (!experience) return;
  ambientAudio.playSoftTick();
  officeEventBus.emit(OFFICE_EVENTS.OFFICE_LIGHTING, { mode }, "hud");
}

function toggleBubbles() {
  showBubbles.value = !showBubbles.value;
  experience?.setBubblesVisible(showBubbles.value);
}

function toggleTaskBoard() {
  isTaskBoardOpen.value = !isTaskBoardOpen.value;
  if (isTaskBoardOpen.value) {
    isOpenCodePanelOpen.value = false;
  }
  ambientAudio.playSoftTick();
}

function toggleOpenCodePanel() {
  isOpenCodePanelOpen.value = !isOpenCodePanelOpen.value;
  if (isOpenCodePanelOpen.value) {
    isTaskBoardOpen.value = false;
    if (openCodeState.value.status === "connected") {
      openCodeTab.value = "command";
    }
  }
  ambientAudio.playSoftTick();
}

function handleSessionSelectChange() {
  const sid = commandForm.sessionId || "";
  if (!sid) {
    openCodeBridge.setActiveSession(null);
    sessionLogEntries.value = [];
    return;
  }
  openCodeBridge.setActiveSession(sid);
  if (openCodeState.value.status === "connected") {
    openCodeBridge.hydrateSessionHistory(sid);
    openCodeBridge.syncPendingQuestions(sid);
  }
}

function dismissBlockedAlert(task) {
  if (!task) return;
  const next = new Set(dismissedBlockedAlertKeys.value);
  next.add(`${task.id}:${task.updatedAt}`);
  dismissedBlockedAlertKeys.value = next;
}

function downloadTextFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadOpenCodeJson() {
  downloadTextFile("opencode.json", OPENCODE_JSON_SNIPPET, "application/json;charset=utf-8");
  ambientAudio.playSoftTick();
}

function downloadOpenCodeReport() {
  const cfg = openCodeBridge.getConfig();
  const report = buildOpenCodeSetupReport({
    profiles: profiles.value,
    aliases: cfg.aliases,
    mode: cfg.mode,
    url: openCodeBridge.getActiveBaseUrl(),
  });
  downloadTextFile(
    "GUIA_CONFIGURACION_OPENCODE.md",
    report,
    "text/markdown;charset=utf-8",
  );
  ambientAudio.playSoftTick();
}

function saveOpenCodeConfig() {
  openCodeBridge.updateConfig({
    mode: openCodeForm.mode,
    directUrl: openCodeForm.directUrl,
    bridgeUrl: openCodeForm.bridgeUrl,
    username: openCodeForm.username,
    password: openCodeForm.password,
    idleCooldownSec: Number(openCodeForm.idleCooldownSec) || 15,
    autoReconnect: openCodeForm.autoReconnect,
  });
}

async function handleToggleOpenCodeConnection() {
  ambientAudio.playSoftTick();
  saveOpenCodeConfig();
  if (
    openCodeState.value.status === "connected" ||
    openCodeState.value.status === "connecting"
  ) {
    openCodeBridge.disconnect();
  } else {
    testResult.value = null;
    openCodeBridge.connect();
  }
}

async function handleTestOpenCodeConnection() {
  ambientAudio.playSoftTick();
  saveOpenCodeConfig();
  isTestingConnection.value = true;
  testResult.value = null;
  testResult.value = await openCodeBridge.testConnection();
  isTestingConnection.value = false;
}

function handleSaveAliases() {
  openCodeBridge.updateConfig({ aliases: { ...aliasDraft } });
  ambientAudio.playSoftTick();
}

function handleResetAliases() {
  const cfg = openCodeBridge.resetAliases();
  syncAliasDraft(cfg);
  ambientAudio.playSoftTick();
}

async function copySnippet(key, text) {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    ambientAudio.playSoftTick();
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
      copiedKey.value = null;
    }, 1800);
  } catch {
    copiedKey.value = null;
  }
}

function openCommandComposer() {
  isOpenCodePanelOpen.value = true;
  openCodeTab.value = "command";
  isTaskBoardOpen.value = false;
  ambientAudio.playSoftTick();
}

async function handleCreateOpenCodeSession() {
  if (isCreatingSession.value) return;
  isCreatingSession.value = true;
  commandFeedback.value = null;
  try {
    const session = await openCodeBridge.createSession({
      agent: commandForm.agent,
    });
    if (session?.id) {
      commandForm.sessionId = session.id;
      commandFeedback.value = {
        ok: true,
        text: `Sesión creada (${session.id.slice(0, 12)})`,
      };
    }
    ambientAudio.playSoftTick();
  } catch (err) {
    commandFeedback.value = {
      ok: false,
      text: err?.message || "No se pudo crear la sesión",
    };
  } finally {
    isCreatingSession.value = false;
  }
}

async function handleSendOpenCodePrompt() {
  if (isSendingPrompt.value || !commandForm.prompt.trim()) return;
  isSendingPrompt.value = true;
  commandFeedback.value = null;
  const targetAgent = commandForm.agent || "architect";
  const res = await openCodeBridge.sendPrompt({
    sessionId: commandForm.sessionId || null,
    agent: targetAgent,
    text: commandForm.prompt,
  });
  isSendingPrompt.value = false;

  if (res.ok) {
    if (res.sessionId) commandForm.sessionId = res.sessionId;
    commandForm.prompt = "";
    commandFeedback.value = {
      ok: true,
      text: `Instrucción enviada a @${targetAgent}`,
    };
    ambientAudio.playSoftTick();
  } else {
    commandFeedback.value = {
      ok: false,
      text: res.error || "No se pudo enviar la instrucción",
    };
  }
}

async function handleInterruptOpenCode() {
  if (isInterrupting.value) return;
  isInterrupting.value = true;
  commandFeedback.value = null;
  const res = await openCodeBridge.interruptSession(
    commandForm.sessionId || openCodeState.value.activeSessionId,
  );
  isInterrupting.value = false;
  commandFeedback.value = res.ok
    ? { ok: true, text: "Ejecución interrumpida" }
    : { ok: false, text: res.error || "No se pudo detener la sesión" };
  ambientAudio.playSoftTick();
}

function handleClearSessionLog() {
  if (!activeLogSessionId.value) return;
  openCodeBridge.clearSessionLog(activeLogSessionId.value);
  ambientAudio.playSoftTick();
}

function handleRefreshSessionHistory() {
  if (!activeLogSessionId.value) return;
  openCodeBridge.hydrateSessionHistory(activeLogSessionId.value, { force: true });
  openCodeBridge.syncPendingQuestions(activeLogSessionId.value);
  ambientAudio.playSoftTick();
}

function handleToggleChildThread(childSessionId, event) {
  if (!childSessionId || !event?.target?.open) return;
  childSessionLogs[childSessionId] = openCodeBridge.getSessionLog(childSessionId);
  openCodeBridge.hydrateSessionHistory(childSessionId);
}

function getChildEntries(childSessionId) {
  if (!childSessionId) return [];
  return childSessionLogs[childSessionId] || openCodeBridge.getSessionLog(childSessionId);
}

function getChildHistoryState(childSessionId) {
  if (!childSessionId) return { status: "idle", error: null };
  return (
    openCodeState.value.sessionHistoryStates?.[childSessionId] || {
      status: "idle",
      error: null,
    }
  );
}

function getQuestionCustomText(item, qIdx) {
  if (!item?.id) return "";
  return questionDrafts[item.id]?.[qIdx]?.custom ?? "";
}

function setQuestionCustomText(item, qIdx, value) {
  if (!item?.id) return;
  const draft = initQuestionDraft(item);
  if (draft?.[qIdx]) {
    draft[qIdx].custom = String(value ?? "");
  }
}

function isOptionSelected(item, qIdx, label) {
  if (!item?.id) return false;
  return Boolean(questionDrafts[item.id]?.[qIdx]?.selected?.includes(label));
}

function toggleQuestionOption(item, qIdx, label) {
  const draft = initQuestionDraft(item);
  const slot = draft?.[qIdx];
  if (!slot) return;
  const isMulti = Boolean(item.questions?.[qIdx]?.multiple);
  if (isMulti) {
    const idx = slot.selected.indexOf(label);
    if (idx === -1) {
      slot.selected.push(label);
    } else {
      slot.selected.splice(idx, 1);
    }
  } else {
    slot.selected = slot.selected[0] === label ? [] : [label];
  }
  ambientAudio.playSoftTick();
}

function canSubmitQuestion(item) {
  if (!item?.id) return false;
  const draft = questionDrafts[item.id];
  if (!Array.isArray(draft)) return false;
  return (item.questions || []).every((_, idx) => {
    const slot = draft[idx];
    return Boolean(slot?.selected?.length > 0 || slot?.custom?.trim());
  });
}

async function handleSubmitQuestion(item) {
  if (!item?.id || replyingQuestionId.value) return;
  const draft = initQuestionDraft(item) || [];
  const answers = (item.questions || []).map((_, idx) => {
    const slot = draft[idx] || { selected: [], custom: "" };
    const vals = [...slot.selected];
    if (slot.custom?.trim()) vals.push(slot.custom.trim());
    return vals;
  });

  replyingQuestionId.value = item.id;
  questionError.value = null;
  const res = await openCodeBridge.replyQuestion(item.id, answers);
  replyingQuestionId.value = null;
  if (res.ok) {
    delete questionDrafts[item.id];
    ambientAudio.playSoftTick();
  } else {
    questionError.value = res.error || "No se pudo enviar la respuesta";
  }
}

async function handleQuickQuestionOption(item, optLabel) {
  if (!item?.id || replyingQuestionId.value) return;
  replyingQuestionId.value = item.id;
  questionError.value = null;
  const res = await openCodeBridge.replyQuestion(item.id, [[optLabel]]);
  replyingQuestionId.value = null;
  if (res.ok) {
    delete questionDrafts[item.id];
    ambientAudio.playSoftTick();
  } else {
    questionError.value = res.error || "No se pudo enviar la respuesta";
  }
}

async function handleRejectQuestion(item) {
  if (!item?.id || replyingQuestionId.value) return;
  replyingQuestionId.value = item.id;
  questionError.value = null;
  const res = await openCodeBridge.replyQuestion(item.id, [], { reject: true });
  replyingQuestionId.value = null;
  if (res.ok) {
    delete questionDrafts[item.id];
    ambientAudio.playSoftTick();
  } else {
    questionError.value = res.error || "No se pudo omitir la pregunta";
  }
}

async function handleReplyPermission(requestId, response) {
  if (replyingPermissionId.value) return;
  replyingPermissionId.value = requestId;
  permissionError.value = null;
  const res = await openCodeBridge.replyPermission(requestId, response);
  replyingPermissionId.value = null;
  if (res.ok) {
    ambientAudio.playSoftTick();
  } else {
    permissionError.value = res.error || "No se pudo responder el permiso";
  }
}

function handleCreateTask() {
  if (!newTask.title.trim()) return;
  taskBoardManager.addTask({
    title: newTask.title,
    file: newTask.file,
    assigneeId: newTask.assigneeId,
    status: newTask.status,
  });
  newTask.title = "";
  newTask.file = "";
}

function handleMoveTask(taskId, status) {
  taskBoardManager.moveTask(taskId, status);
}

function handleDeleteTask(taskId) {
  taskBoardManager.deleteTask(taskId);
  ambientAudio.playSoftTick();
}

function handleClearDemoTasks() {
  taskBoardManager.clearDemoTasks();
  ambientAudio.playSoftTick();
}

function handleSaveProfile() {
  if (!selectedAgentId.value) return;
  agentProfileManager.updateProfile(selectedAgentId.value, {
    name: profileDraft.name,
    role: profileDraft.role,
    color: profileDraft.color,
  });
  ambientAudio.playSoftTick();
}

function handleResetProfiles() {
  agentProfileManager.resetProfiles();
  syncProfileDraft();
  ambientAudio.playSoftTick();
}

async function toggleAudio() {
  audioEnabled.value = await ambientAudio.toggle();
}

function handleVolumeInput(e) {
  audioVolume.value = Number(e.target.value);
  ambientAudio.setVolume(audioVolume.value);
}

function triggerBusTest(item) {
  if (!selectedAgentId.value || !experience) return;
  if (item.type === "custom:pair_chat") {
    experience.triggerPairChat(selectedAgentId.value);
    return;
  }
  if (item.type === "custom:desk_review") {
    experience.triggerDeskReview(selectedAgentId.value);
    return;
  }
  officeEventBus.emit(
    item.type,
    item.buildPayload(selectedAgentId.value),
    "hud-bus",
  );
}

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyDown);
  unsubBusHistory?.();
  unsubProfileSync?.();
  unsubTaskSync?.();
  unsubOpenCode?.();
  unsubSessionLog?.();
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
  openCodeBridge.dispose();
  ambientAudio.dispose();
  experience?.destroy();
});
</script>

<template>
  <main
    class="w-full h-screen relative bg-[#111318] overflow-hidden font-sans select-none text-[#F3F4F6]"
  >
    <!-- Contenedor aislado del Canvas WebGL (100% intacto sin resize lateral) -->
    <div class="w-full h-full relative">
      <canvas ref="canvasRef" class="w-full h-full block outline-none" />
    </div>

    <!-- Pantalla de carga inicial -->
    <div
      v-if="!isReady"
      class="absolute inset-0 bg-[#111318] flex flex-col items-center justify-center p-6 z-50"
    >
      <div class="w-80 space-y-3">
        <div class="flex items-center justify-between text-xs text-[#9CA3AF]">
          <span class="font-medium text-[#F3F4F6]">
            Inicializando Oficina Virtual 3D
          </span>
          <span class="tabular-nums">{{ loadProgress }}%</span>
        </div>
        <div class="w-full h-1.5 bg-[#1F232D] rounded-md overflow-hidden">
          <div
            class="h-full bg-[#4F6EF7] transition-all duration-150 ease-out"
            :style="{ width: `${loadProgress}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- ZONA 1: Isla Superior Izquierda (Telemetría + Iluminación + Vista General) -->
    <header
      v-if="isReady"
      class="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#111318]/94 border border-white/[0.08] pointer-events-auto max-w-[calc(100vw-2rem)]"
    >
      <div class="flex items-center gap-2.5 pr-1">
        <h1 class="text-[13px] font-semibold tracking-tight text-[#F3F4F6] whitespace-nowrap">
          Oficina Virtual 3D
        </h1>
        <span aria-hidden="true" class="text-[#4B5563]">·</span>
        <span
          :class="[
            'text-xs font-medium tabular-nums whitespace-nowrap',
            openCodeState.status === 'connected'
              ? 'text-[#93A8FA]'
              : openCodeState.status === 'error'
                ? 'text-[#FB7185]'
                : openCodeState.status === 'connecting'
                  ? 'text-[#D97706]'
                  : 'text-[#9CA3AF]',
          ]"
        >
          {{
            openCodeState.status === "connected"
              ? `OpenCode ${openCodeState.activeAgents.length}/5`
              : openCodeState.status === "connecting"
                ? "Conectando"
                : openCodeState.status === "error"
                  ? "Error de enlace"
                  : directorState.paused
                    ? "Simulación en pausa"
                    : "Autónoma"
          }}
        </span>
        <span aria-hidden="true" class="text-[#4B5563]">·</span>
        <span class="text-xs text-[#9CA3AF] whitespace-nowrap">
          {{ openCodeState.mode === "bridge" ? "Puente" : "Directo" }}
        </span>
      </div>

      <div class="w-px h-4 bg-white/[0.08] hidden sm:block"></div>

      <!-- Selector de Iluminación -->
      <div
        class="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#181B22] border border-white/[0.08]"
      >
        <button
          type="button"
          @click="setLightingMode('day')"
          :class="[
            'px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
            timeMode === 'day'
              ? 'bg-[#26221A] text-[#F59E0B]'
              : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
          ]"
        >
          <Sun class="w-3.5 h-3.5" />
          <span>Día</span>
        </button>
        <button
          type="button"
          @click="setLightingMode('night')"
          :class="[
            'px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
            timeMode === 'night'
              ? 'bg-[#1E243B] text-[#93A8FA]'
              : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
          ]"
        >
          <Moon class="w-3.5 h-3.5" />
          <span>Noche</span>
        </button>
        <button
          type="button"
          @click="setLightingMode('auto')"
          :class="[
            'px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
            timeMode === 'auto'
              ? 'bg-[#232834] text-[#E5E7EB]'
              : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
          ]"
        >
          <RefreshCw class="w-3.5 h-3.5" />
          <span>Auto</span>
        </button>
      </div>

      <!-- Reset Cámara -->
      <button
        type="button"
        @click="
          experience?.handleStationSelect(null);
          experience?.resetCamera();
        "
        class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
      >
        <RotateCcw class="w-3.5 h-3.5" />
        <span>Vista General</span>
      </button>
    </header>

    <!-- ZONA 2: Esquina Superior Derecha (Triggers OpenCode & Tablero + Pila de Toasts) -->
    <div
      v-if="isReady"
      class="absolute top-4 right-4 z-30 flex flex-col items-end gap-2.5 pointer-events-none"
    >
      <div class="flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          @click="toggleOpenCodePanel"
          :class="[
            'px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap',
            isOpenCodePanelOpen || openCodeState.status === 'connected'
              ? 'bg-[#1E243B] border-[#4F6EF7]/45 text-[#E0E7FF] hover:bg-[#252D49]'
              : openCodeState.status === 'error'
                ? 'bg-[#2B141C] border-[#E11D48]/45 text-[#FECDD3] hover:bg-[#381A24]'
                : 'bg-[#111318]/94 border-white/[0.08] text-[#E5E7EB] hover:bg-[#1F232D] hover:border-[#2E3442]',
          ]"
        >
          <Terminal class="w-3.5 h-3.5 text-[#4F6EF7]" />
          <span>OpenCode</span>
          <span aria-hidden="true" class="text-[#4B5563]">·</span>
          <span
            :class="[
              'text-[11px] tabular-nums',
              openCodeState.status === 'connected'
                ? 'text-[#10B981]'
                : openCodeState.status === 'error'
                  ? 'text-[#FB7185]'
                  : 'text-[#9CA3AF]',
            ]"
          >
            {{
              openCodeState.status === "connected"
                ? `${openCodeState.activeAgents.length}/5 vivo`
                : openCodeState.status === "connecting"
                  ? "Conectando"
                  : openCodeState.status === "error"
                    ? "Error"
                    : "Configurar"
            }}
          </span>
          <span
            v-if="openCodeState.pendingPermissions.length + openCodeState.pendingQuestions.length > 0"
            class="px-1.5 py-0.5 rounded bg-[#D97706] text-[10px] font-semibold text-[#111318] tabular-nums"
          >
            {{ openCodeState.pendingPermissions.length + openCodeState.pendingQuestions.length }}
          </span>
        </button>

        <button
          type="button"
          @click="toggleTaskBoard"
          :class="[
            'px-3 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap',
            isTaskBoardOpen
              ? 'bg-[#1E243B] border-[#4F6EF7]/45 text-[#E0E7FF]'
              : 'bg-[#111318]/94 border-white/[0.08] text-[#E5E7EB] hover:bg-[#1F232D] hover:border-[#2E3442]',
          ]"
        >
          <ListTodo class="w-3.5 h-3.5 text-[#9CA3AF]" />
          <span>Tablero</span>
          <span aria-hidden="true" class="text-[#4B5563]">·</span>
          <span class="text-[11px] text-[#9CA3AF] tabular-nums">
            {{ tasks.length }}
          </span>
        </button>
      </div>

      <!-- Pila discreta de Toasts (Permisos CLI, Preguntas interactivas y alertas) -->
      <div
        v-if="activePermission || (activeQuestion && !isOpenCodePanelOpen) || blockedCliAlerts.length > 0"
        class="w-[min(390px,92vw)] flex flex-col gap-2 pointer-events-auto"
      >
        <!-- Toast compacto de Pregunta interactiva cuando el drawer está cerrado -->
        <div
          v-if="activeQuestion && !isOpenCodePanelOpen"
          class="rounded-xl bg-[#111318]/96 border border-[#4F6EF7]/45 p-3.5 space-y-2.5"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#93A8FA]">
              <MessageSquare class="w-4 h-4 text-[#4F6EF7] shrink-0" />
              <span>Pregunta del agente</span>
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-[#9CA3AF] tabular-nums">
              <span>{{ profileMap[activeQuestion.agentId]?.name || activeQuestion.agentId }}</span>
              <span aria-hidden="true" class="text-[#4B5563]">·</span>
              <span>1 de {{ openCodeState.pendingQuestions.length }}</span>
            </div>
          </div>

          <div class="text-xs text-[#F3F4F6] leading-relaxed">
            {{ activeQuestion.questions[0]?.question }}
          </div>

          <div v-if="questionError" class="text-xs text-[#FB7185]">
            {{ questionError }}
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <template
              v-if="
                activeQuestion.questions.length === 1 &&
                !activeQuestion.questions[0]?.multiple &&
                activeQuestion.questions[0]?.options?.length > 0
              "
            >
              <button
                v-for="(opt, optIdx) in activeQuestion.questions[0].options.slice(0, 3)"
                :key="`${opt.label}_${optIdx}`"
                type="button"
                :disabled="replyingQuestionId === activeQuestion.id"
                @click="handleQuickQuestionOption(activeQuestion, opt.label)"
                class="px-2.5 py-1.5 rounded-lg bg-[#1E243B] hover:bg-[#27304F] border border-[#4F6EF7]/35 text-xs font-medium text-[#E0E7FF] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {{ opt.label }}
              </button>
            </template>
            <button
              type="button"
              @click="openCommandComposer"
              class="px-2.5 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer whitespace-nowrap"
            >
              Responder en Comando
            </button>
          </div>
        </div>
        <!-- Toast de Permiso CLI -->
        <div
          v-if="activePermission"
          class="rounded-xl bg-[#111318]/96 border border-[#D97706]/45 p-3.5 space-y-2.5"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#FBBF24]">
              <ShieldAlert class="w-4 h-4 text-[#D97706] shrink-0" />
              <span>Permiso CLI pendiente</span>
            </div>
            <div class="flex items-center gap-1.5 text-[11px] text-[#9CA3AF] tabular-nums">
              <span>{{ profileMap[activePermission.agentId]?.name || activePermission.agentId }}</span>
              <span aria-hidden="true" class="text-[#4B5563]">·</span>
              <span>1 de {{ openCodeState.pendingPermissions.length }}</span>
            </div>
          </div>

          <div class="space-y-1.5">
            <div class="text-xs font-medium text-[#F3F4F6]">
              {{ activePermission.title }}
              <span aria-hidden="true" class="text-[#4B5563] mx-1">·</span>
              <span class="text-[#93A8FA]">{{ activePermission.toolName }}</span>
            </div>
            <div class="text-[11px] text-[#D1D5DB] bg-[#181B22] border border-white/[0.06] rounded-lg px-2.5 py-1.5 truncate tabular-nums">
              {{ activePermission.targetSummary }}
            </div>
          </div>

          <div v-if="permissionError" class="text-xs text-[#FB7185]">
            {{ permissionError }}
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'once')"
              class="px-2.5 py-1.5 rounded-lg bg-[#0E9F6E] hover:bg-[#10B981] text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Permitir una vez
            </button>
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'always')"
              class="px-2.5 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Permitir siempre
            </button>
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'reject')"
              class="px-2.5 py-1.5 rounded-lg bg-[#2B141C] hover:bg-[#3A1B26] border border-[#E11D48]/35 text-xs font-medium text-[#FECDD3] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        </div>

        <!-- Toast de Sesiones bloqueadas / Esperando respuesta en CLI (question/form) -->
        <div
          v-for="alert in blockedCliAlerts"
          :key="alert.id"
          class="rounded-xl bg-[#111318]/96 border border-[#E11D48]/40 p-3 space-y-2"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#FDA4AF]">
              <AlertTriangle class="w-4 h-4 text-[#E11D48] shrink-0" />
              <span>{{ alert.title }}</span>
            </div>
            <button
              type="button"
              @click="dismissBlockedAlert(alert)"
              aria-label="Cerrar alerta"
              class="p-0.5 rounded text-[#9CA3AF] hover:text-[#F3F4F6] hover:bg-[#1F232D] transition-colors cursor-pointer"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px] text-[#9CA3AF]">
            <span class="truncate">
              {{ profileMap[alert.assigneeId]?.name || alert.assigneeId }} · {{ alert.file }}
            </span>
            <button
              type="button"
              @click="openCommandComposer"
              class="px-2 py-1 rounded-md bg-[#1F232D] hover:bg-[#282D3B] border border-white/[0.08] text-[11px] font-medium text-[#E5E7EB] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Ver Comando
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ZONA 3: Isla Inferior Compacta + Popover Contextual del Inspector -->
    <section
      v-if="isReady"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center w-auto max-w-[95vw] pointer-events-none"
    >
      <!-- Inspector Compacto sobre la isla inferior al seleccionar avatar -->
      <transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-120 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-2"
      >
        <div
          v-if="selectedSnapshot && !isDockCollapsed"
          class="pointer-events-auto mb-2.5 w-[min(780px,94vw)] rounded-xl bg-[#111318]/96 border border-white/[0.08] p-3.5 space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <span
                class="w-3 h-3 rounded-[3px] shrink-0"
                :style="{ backgroundColor: selectedSnapshot.color }"
              ></span>
              <div class="min-w-0">
                <div class="flex items-center gap-2 text-xs font-semibold text-[#F3F4F6]">
                  <span class="truncate">{{ selectedSnapshot.name }}</span>
                  <span aria-hidden="true" class="text-[#4B5563]">·</span>
                  <span class="font-normal text-[#9CA3AF] truncate">
                    {{ selectedSnapshot.role }}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-[#9CA3AF] tabular-nums">
                  <span class="text-[#E5E7EB]">{{ selectedSnapshot.state }}</span>
                  <span aria-hidden="true" class="text-[#4B5563]">·</span>
                  <span>Zona: {{ selectedSnapshot.zone }}</span>
                  <span aria-hidden="true" class="text-[#4B5563]">·</span>
                  <span>Clip: {{ selectedSnapshot.animation }}</span>
                  <span aria-hidden="true" class="text-[#4B5563]">·</span>
                  <span>Prop: {{ selectedSnapshot.prop }}</span>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 shrink-0">
              <div
                class="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#181B22] border border-white/[0.08]"
              >
                <button
                  type="button"
                  @click="activeInspectorTab = 'routes'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    activeInspectorTab === 'routes'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
                  ]"
                >
                  Recorridos
                </button>
                <button
                  type="button"
                  @click="activeInspectorTab = 'animations'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    activeInspectorTab === 'animations'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
                  ]"
                >
                  Animaciones y Props
                </button>
                <button
                  type="button"
                  @click="activeInspectorTab = 'events'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1',
                    activeInspectorTab === 'events'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
                  ]"
                >
                  <Radio class="w-3 h-3" />
                  <span>Event Bus</span>
                </button>
                <button
                  type="button"
                  @click="activeInspectorTab = 'profile'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1',
                    activeInspectorTab === 'profile'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
                  ]"
                >
                  <UserCog class="w-3 h-3" />
                  <span>Perfil</span>
                </button>
              </div>

              <button
                type="button"
                @click="experience?.focusAgent(selectedSnapshot.id)"
                class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Crosshair class="w-3.5 h-3.5" />
                <span>Enfocar</span>
              </button>

              <button
                type="button"
                @click="experience?.handleStationSelect(null)"
                aria-label="Cerrar inspector"
                class="p-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors cursor-pointer"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div class="max-h-44 overflow-y-auto pt-1 border-t border-white/[0.06]">
            <!-- Tab Recorridos -->
            <div
              v-if="activeInspectorTab === 'routes'"
              class="flex flex-wrap items-center gap-1.5 pt-1"
            >
              <button
                v-for="trigger in ROUTE_TRIGGERS"
                :key="trigger.checkpointId"
                type="button"
                @click="sendToRoute(trigger)"
                class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] transition-colors cursor-pointer whitespace-nowrap"
              >
                {{ trigger.label }}
              </button>
              <button
                type="button"
                @click="sendSelectedHome"
                class="px-2.5 py-1.5 rounded-lg bg-[#1E243B] hover:bg-[#262F4D] border border-[#4F6EF7]/35 text-xs font-medium text-[#C7D2FE] transition-colors cursor-pointer whitespace-nowrap"
              >
                Volver al Escritorio
              </button>
            </div>

            <!-- Tab Animaciones y Props -->
            <div
              v-else-if="activeInspectorTab === 'animations'"
              class="flex flex-wrap items-center gap-1.5 pt-1"
            >
              <button
                v-for="anim in ANIMATION_TRIGGERS"
                :key="anim.action"
                type="button"
                @click="triggerAnimationPreview(anim.action)"
                :class="[
                  'px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                  selectedSnapshot.animation === anim.action
                    ? 'bg-[#1E243B] border-[#4F6EF7]/40 text-[#E0E7FF]'
                    : 'bg-[#181B22] hover:bg-[#252A36] border-white/[0.08] text-[#D1D5DB] hover:text-[#F3F4F6]',
                ]"
              >
                {{ anim.label }}
              </button>
            </div>

            <!-- Tab Event Bus -->
            <div v-else-if="activeInspectorTab === 'events'" class="space-y-2 pt-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="item in BUS_TEST_ACTIONS"
                  :key="item.label"
                  type="button"
                  @click="triggerBusTest(item)"
                  class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] transition-colors cursor-pointer whitespace-nowrap"
                >
                  {{ item.label }}
                </button>
              </div>
              <div
                v-if="eventLog.length > 0"
                class="rounded-lg bg-[#181B22] border border-white/[0.06] px-3 py-2 space-y-1 max-h-24 overflow-y-auto text-[11px] text-[#9CA3AF] tabular-nums"
              >
                <div
                  v-for="ev in eventLog"
                  :key="ev.id"
                  class="flex items-center justify-between gap-3 truncate"
                >
                  <span class="text-[#93A8FA] shrink-0">{{ ev.type }}</span>
                  <span class="truncate text-[#D1D5DB]">
                    {{
                      ev.payload.label ||
                      ev.payload.topic ||
                      ev.payload.venue ||
                      ev.payload.mode ||
                      ev.payload.agentId ||
                      ""
                    }}
                  </span>
                  <span class="text-[#6B7280] shrink-0">{{ ev.source }}</span>
                </div>
              </div>
            </div>

            <!-- Tab Perfil -->
            <form
              v-else
              @submit.prevent="handleSaveProfile"
              class="flex flex-wrap items-end justify-between gap-3 pt-1"
            >
              <div class="flex flex-wrap items-end gap-2.5 flex-1 min-w-[240px]">
                <label class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                  <span>Nombre</span>
                  <input
                    v-model="profileDraft.name"
                    type="text"
                    maxlength="20"
                    class="w-36 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7]"
                  />
                </label>

                <label class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                  <span>Especialidad / Rol</span>
                  <input
                    v-model="profileDraft.role"
                    type="text"
                    maxlength="28"
                    class="w-44 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7]"
                  />
                </label>

                <div class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                  <span>Color</span>
                  <div class="flex items-center gap-1.5 h-[30px]">
                    <button
                      v-for="swatch in AGENT_COLOR_PALETTE"
                      :key="swatch.hex"
                      type="button"
                      :title="swatch.name"
                      :aria-label="swatch.name"
                      @click="profileDraft.color = swatch.hex"
                      :class="[
                        'w-5 h-5 rounded-[4px] transition-transform cursor-pointer border',
                        profileDraft.color === swatch.hex
                          ? 'scale-110 border-[#D1D5DB]'
                          : 'border-white/[0.12] opacity-80 hover:opacity-100',
                      ]"
                      :style="{ backgroundColor: swatch.hex }"
                    ></button>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  class="px-3 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Aplicar cambios
                </button>
                <button
                  type="button"
                  @click="handleResetProfiles"
                  class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Restaurar equipo
                </button>
              </div>
            </form>
          </div>
        </div>
      </transition>

      <!-- Botón discreto de colapso (H) -->
      <button
        @click="isDockCollapsed = !isDockCollapsed"
        type="button"
        class="pointer-events-auto mb-1.5 px-2.5 py-1 rounded-lg bg-[#111318]/90 hover:bg-[#181B22] border border-white/[0.08] text-[11px] font-medium text-[#9CA3AF] hover:text-[#E5E7EB] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
      >
        <ChevronDown v-if="!isDockCollapsed" class="w-3.5 h-3.5" />
        <ChevronUp v-else class="w-3.5 h-3.5" />
        <span>{{ isDockCollapsed ? "Mostrar barra (H)" : "Ocultar (H)" }}</span>
      </button>

      <!-- Isla Inferior Compacta (5 Avatares + Pausa/Velocidad + Acciones de Escena) -->
      <transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-120 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-2"
      >
        <div
          v-show="!isDockCollapsed"
          class="pointer-events-auto rounded-xl bg-[#111318]/95 border border-white/[0.08] px-3 py-2 flex flex-wrap items-center justify-center gap-2"
        >
          <!-- Equipo (5 Avatares) -->
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="agent in agentList"
              :key="agent.id"
              type="button"
              @click="selectAgentFromDock(agent.id)"
              :style="getAgentAvatarStyle(agent)"
              :class="[
                'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap border',
                selectedAgentId === agent.id
                  ? 'text-[#F3F4F6]'
                  : 'bg-[#181B22] border-white/[0.08] text-[#D1D5DB] hover:bg-[#232834] hover:text-[#F3F4F6]',
              ]"
            >
              <span
                class="w-2.5 h-2.5 rounded-[3px] shrink-0"
                :style="{ backgroundColor: agent.color }"
              ></span>
              <span>{{ agent.name }}</span>
              <span
                v-if="openCodeState.activeAgents.includes(agent.id)"
                class="text-[10px] font-semibold text-[#10B981] tabular-nums"
              >
                · vivo
              </span>
            </button>
          </div>

          <div class="w-px h-5 bg-white/[0.08] hidden md:block"></div>

          <!-- Reproducción (Pausa / 1x–2x) -->
          <div
            class="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#181B22] border border-white/[0.08]"
          >
            <button
              type="button"
              @click="toggleDirectorPause"
              class="px-2.5 py-1 rounded-md text-xs font-medium text-[#D1D5DB] hover:bg-[#252A36] hover:text-[#F3F4F6] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play v-if="directorState.paused" class="w-3.5 h-3.5" />
              <Pause v-else class="w-3.5 h-3.5" />
              <span>{{ directorState.paused ? "Reanudar" : "Pausa" }}</span>
            </button>
            <button
              type="button"
              @click="toggleDirectorSpeed"
              class="px-2 py-1 rounded-md text-xs font-medium tabular-nums text-[#9CA3AF] hover:bg-[#252A36] hover:text-[#F3F4F6] transition-colors cursor-pointer whitespace-nowrap"
            >
              {{ directorState.speedMultiplier }}x
            </button>
          </div>

          <div class="w-px h-5 bg-white/[0.08] hidden md:block"></div>

          <!-- Triggers rápidos de escena -->
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              @click="experience?.triggerPairChat()"
              class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <MessageSquare class="w-3.5 h-3.5" />
              <span>Charla</span>
            </button>

            <button
              type="button"
              @click="experience?.triggerDeskReview()"
              class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <GitPullRequest class="w-3.5 h-3.5" />
              <span>Revisión</span>
            </button>

            <button
              type="button"
              @click="experience?.triggerPingPongMatch()"
              class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Gamepad2 class="w-3.5 h-3.5" />
              <span>Ping-Pong</span>
            </button>

            <button
              type="button"
              @click="experience?.triggerTeamMeeting()"
              class="px-2.5 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] hover:text-[#F3F4F6] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Users class="w-3.5 h-3.5" />
              <span>Reunión</span>
            </button>

            <button
              type="button"
              @click="toggleBubbles"
              :class="[
                'px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap',
                showBubbles
                  ? 'bg-[#1E243B] border-[#4F6EF7]/40 text-[#C7D2FE]'
                  : 'bg-[#181B22] hover:bg-[#252A36] border-white/[0.08] text-[#9CA3AF] hover:text-[#E5E7EB]',
              ]"
            >
              <MessageSquare class="w-3.5 h-3.5" />
              <span>Burbujas</span>
            </button>

            <div
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08]"
            >
              <button
                type="button"
                @click="toggleAudio"
                :class="[
                  'text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap',
                  audioEnabled ? 'text-[#93A8FA]' : 'text-[#9CA3AF] hover:text-[#E5E7EB]',
                ]"
              >
                <Volume2 v-if="audioEnabled" class="w-3.5 h-3.5" />
                <VolumeX v-else class="w-3.5 h-3.5" />
                <span>Audio</span>
              </button>
              <input
                v-if="audioEnabled"
                type="range"
                min="0"
                max="1"
                step="0.05"
                :value="audioVolume"
                @input="handleVolumeInput"
                aria-label="Volumen ambiental"
                class="w-12 accent-[#4F6EF7] cursor-pointer"
              />
            </div>
          </div>
        </div>
      </transition>
    </section>

    <!-- ZONA 4A: Drawer Lateral Derecho Superpuesto de OpenCode (mantiene escena 3D intacta) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-x-6"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-6"
    >
      <aside
        v-if="isReady && isOpenCodePanelOpen"
        class="fixed top-4 right-4 bottom-4 w-[min(450px,calc(100vw-2rem))] z-40 rounded-xl bg-[#111318]/97 border border-white/[0.08] flex flex-col overflow-hidden pointer-events-auto"
      >
        <!-- Cabecera del Drawer -->
        <div class="px-4 py-3 border-b border-white/[0.08] bg-[#181B22] space-y-2.5 shrink-0">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <Terminal class="w-4 h-4 text-[#4F6EF7] shrink-0" />
              <span class="text-sm font-semibold text-[#F3F4F6]">OpenCode</span>
              <span aria-hidden="true" class="text-[#4B5563]">·</span>
              <span
                :class="[
                  'text-xs font-medium truncate',
                  openCodeState.status === 'connected'
                    ? 'text-[#10B981]'
                    : openCodeState.status === 'error'
                      ? 'text-[#FB7185]'
                      : openCodeState.status === 'connecting'
                        ? 'text-[#D97706]'
                        : 'text-[#9CA3AF]',
                ]"
              >
                {{
                  openCodeState.status === "connected"
                    ? "Stream SSE activo"
                    : openCodeState.status === "connecting"
                      ? "Conectando..."
                      : openCodeState.status === "error"
                        ? "Error de enlace"
                        : "Desconectado"
                }}
              </span>
            </div>

            <button
              type="button"
              @click="isOpenCodePanelOpen = false"
              aria-label="Cerrar drawer OpenCode"
              class="p-1.5 rounded-lg bg-[#1F232D] hover:bg-[#282E3D] border border-white/[0.08] text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors cursor-pointer"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Pestañas del Drawer -->
          <div
            class="grid grid-cols-4 gap-1 p-0.5 rounded-lg bg-[#111318] border border-white/[0.08]"
          >
            <button
              type="button"
              @click="openCodeTab = 'command'"
              :class="[
                'px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-center',
                openCodeTab === 'command'
                  ? 'bg-[#1E243B] text-[#E0E7FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
              ]"
            >
              Comando
            </button>
            <button
              type="button"
              @click="openCodeTab = 'connection'"
              :class="[
                'px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-center',
                openCodeTab === 'connection'
                  ? 'bg-[#1E243B] text-[#E0E7FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
              ]"
            >
              Conexión
            </button>
            <button
              type="button"
              @click="openCodeTab = 'mapping'"
              :class="[
                'px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-center',
                openCodeTab === 'mapping'
                  ? 'bg-[#1E243B] text-[#E0E7FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
              ]"
            >
              Mapeo
            </button>
            <button
              type="button"
              @click="openCodeTab = 'guide'"
              :class="[
                'px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap text-center',
                openCodeTab === 'guide'
                  ? 'bg-[#1E243B] text-[#E0E7FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1F232D] hover:text-[#E5E7EB]',
              ]"
            >
              Guía
            </button>
          </div>
        </div>

        <!-- Banner inline de pregunta interactiva (`question`) -->
        <div
          v-if="activeQuestion"
          class="px-4 py-3 border-b border-[#4F6EF7]/35 bg-[#161B29] space-y-2.5 shrink-0 max-h-[44vh] overflow-y-auto"
        >
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="font-semibold text-[#93A8FA] flex items-center gap-1.5">
              <MessageSquare class="w-3.5 h-3.5 text-[#4F6EF7]" />
              <span>Pregunta pendiente</span>
            </span>
            <span class="text-[11px] text-[#9CA3AF] tabular-nums">
              {{ profileMap[activeQuestion.agentId]?.name || activeQuestion.agentId }} · 1 de
              {{ openCodeState.pendingQuestions.length }}
            </span>
          </div>

          <div
            v-for="(q, qIdx) in activeQuestion.questions"
            :key="`${activeQuestion.id}_${qIdx}`"
            class="space-y-1.5"
          >
            <div class="text-[11px] font-medium text-[#9CA3AF]">
              {{ q.header }}
              <span v-if="q.multiple" class="text-[#6B7280]"> · Selección múltiple</span>
            </div>
            <div class="text-xs text-[#F3F4F6] leading-relaxed select-text">
              {{ q.question }}
            </div>

            <div v-if="q.options.length > 0" class="flex flex-col gap-1 pt-0.5">
              <button
                v-for="(opt, optIdx) in q.options"
                :key="`${opt.label}_${optIdx}`"
                type="button"
                :disabled="replyingQuestionId === activeQuestion.id"
                @click="toggleQuestionOption(activeQuestion, qIdx, opt.label)"
                :class="[
                  'w-full text-left px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer flex items-start justify-between gap-2 disabled:opacity-50',
                  isOptionSelected(activeQuestion, qIdx, opt.label)
                    ? 'bg-[#1E243B] border-[#4F6EF7]/65 text-[#E0E7FF]'
                    : 'bg-[#111318] border-white/[0.08] text-[#D1D5DB] hover:bg-[#1F232D]',
                ]"
              >
                <span class="min-w-0">
                  <span class="font-medium block">{{ opt.label }}</span>
                  <span
                    v-if="opt.description"
                    class="text-[11px] text-[#9CA3AF] block leading-snug"
                  >
                    {{ opt.description }}
                  </span>
                </span>
                <Check
                  v-if="isOptionSelected(activeQuestion, qIdx, opt.label)"
                  class="w-3.5 h-3.5 text-[#93A8FA] shrink-0 mt-0.5"
                />
              </button>
            </div>

            <input
              v-if="q.custom !== false"
              :value="getQuestionCustomText(activeQuestion, qIdx)"
              @input="setQuestionCustomText(activeQuestion, qIdx, $event.target.value)"
              type="text"
              @keydown.ctrl.enter.prevent="canSubmitQuestion(activeQuestion) && handleSubmitQuestion(activeQuestion)"
              :placeholder="
                q.options.length > 0
                  ? 'O escribe otra respuesta...'
                  : 'Escribe tu respuesta...'
              "
              class="w-full px-2.5 py-1.5 rounded-lg bg-[#111318] border border-white/[0.08] text-xs text-[#F3F4F6] placeholder:text-[#6B7280] focus:outline-none focus:border-[#4F6EF7]"
            />
          </div>

          <div v-if="questionError" class="text-[11px] text-[#FB7185]">
            {{ questionError }}
          </div>

          <div class="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              :disabled="replyingQuestionId === activeQuestion.id"
              @click="handleRejectQuestion(activeQuestion)"
              class="px-2.5 py-1.5 rounded-md bg-[#2B141C] hover:bg-[#3A1B26] border border-[#E11D48]/35 text-[11px] font-medium text-[#FECDD3] cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Omitir
            </button>
            <button
              type="button"
              :disabled="replyingQuestionId === activeQuestion.id || !canSubmitQuestion(activeQuestion)"
              @click="handleSubmitQuestion(activeQuestion)"
              class="px-3 py-1.5 rounded-md bg-[#4F6EF7] hover:bg-[#5E7BF8] text-[11px] font-medium text-[#F8FAFC] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-45"
            >
              <Send class="w-3 h-3" />
              <span>{{ replyingQuestionId === activeQuestion.id ? "Enviando..." : "Enviar respuesta" }}</span>
            </button>
          </div>
        </div>

        <!-- Banner inline de permiso pendiente si el drawer está abierto -->
        <div
          v-if="activePermission"
          class="px-4 py-2.5 border-b border-[#D97706]/35 bg-[#1B1710] space-y-2 shrink-0"
        >
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="font-semibold text-[#FBBF24] flex items-center gap-1.5">
              <ShieldAlert class="w-3.5 h-3.5 text-[#D97706]" />
              <span>Permiso CLI: {{ activePermission.toolName }}</span>
            </span>
            <span class="text-[11px] text-[#D1D5DB] truncate max-w-[140px]">
              {{ activePermission.targetSummary }}
            </span>
          </div>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'once')"
              class="px-2 py-1 rounded-md bg-[#0E9F6E] hover:bg-[#10B981] text-[11px] font-medium text-[#F8FAFC] cursor-pointer disabled:opacity-50"
            >
              Una vez
            </button>
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'always')"
              class="px-2 py-1 rounded-md bg-[#4F6EF7] hover:bg-[#5E7BF8] text-[11px] font-medium text-[#F8FAFC] cursor-pointer disabled:opacity-50"
            >
              Siempre
            </button>
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'reject')"
              class="px-2 py-1 rounded-md bg-[#2B141C] hover:bg-[#3A1B26] border border-[#E11D48]/35 text-[11px] font-medium text-[#FECDD3] cursor-pointer disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        </div>

        <!-- Pestaña Comando + Bitácora Vertical Amplia -->
        <div
          v-if="openCodeTab === 'command'"
          class="flex-1 min-h-0 flex flex-col overflow-hidden"
        >
          <div class="p-4 border-b border-white/[0.08] space-y-2.5 shrink-0">
            <div
              v-if="openCodeState.status !== 'connected'"
              class="rounded-lg bg-[#181B22] border border-white/[0.08] p-3 flex flex-col gap-2.5 text-xs text-[#D1D5DB]"
            >
              <span>Conecta primero con OpenCode para enviar prompts y seguir la bitácora en vivo.</span>
              <button
                type="button"
                @click="openCodeTab = 'connection'"
                class="self-start px-3 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] cursor-pointer"
              >
                Ir a Conexión
              </button>
            </div>

            <form
              v-else
              @submit.prevent="handleSendOpenCodePrompt"
              class="space-y-2.5"
            >
              <div class="grid grid-cols-1 gap-2">
                <div class="flex items-center gap-1.5">
                  <select
                    v-model="commandForm.sessionId"
                    @change="handleSessionSelectChange"
                    aria-label="Sesión OpenCode"
                    class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7] tabular-nums"
                  >
                    <option value="">Auto (crear nueva al enviar)</option>
                    <option
                      v-for="sess in openCodeState.sessions"
                      :key="sess.id"
                      :value="sess.id"
                    >
                      {{
                        sess.title
                          ? `${sess.title.slice(0, 26)} (${sess.id.slice(0, 10)})`
                          : sess.id
                      }}
                    </option>
                  </select>
                  <button
                    type="button"
                    :disabled="isCreatingSession"
                    @click="handleCreateOpenCodeSession"
                    class="px-2.5 py-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272C39] border border-white/[0.08] text-xs font-medium text-[#E5E7EB] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Plus class="w-3.5 h-3.5" />
                    <span>{{ isCreatingSession ? "Creando..." : "Nueva" }}</span>
                  </button>
                </div>

                <div class="flex items-center gap-1.5">
                  <select
                    v-model="commandForm.agent"
                    aria-label="Agente destinatario"
                    class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7]"
                  >
                    <option
                      v-for="ag in agentList"
                      :key="ag.id"
                      :value="ag.id"
                    >
                      {{ ag.name }} (@{{ ag.id }})
                    </option>
                  </select>
                  <button
                    type="button"
                    :disabled="isInterrupting || !(commandForm.sessionId || openCodeState.activeSessionId)"
                    @click="handleInterruptOpenCode"
                    class="px-2.5 py-1.5 rounded-lg bg-[#2B141C] hover:bg-[#3A1B26] border border-[#E11D48]/35 text-xs font-medium text-[#FECDD3] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
                  >
                    <Square class="w-3 h-3 fill-current" />
                    <span>{{ isInterrupting ? "Deteniendo..." : "Detener" }}</span>
                  </button>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <textarea
                  v-model="commandForm.prompt"
                  rows="2"
                  @keydown.ctrl.enter.prevent="handleSendOpenCodePrompt"
                  @keydown.meta.enter.prevent="handleSendOpenCodePrompt"
                  placeholder="Escribe una instrucción para OpenCode (Ctrl+Enter para enviar)..."
                  class="w-full px-3 py-2 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] placeholder:text-[#6B7280] focus:outline-none focus:border-[#4F6EF7] resize-none"
                ></textarea>

                <div class="flex items-center justify-between gap-2">
                  <span
                    v-if="commandFeedback"
                    :class="[
                      'text-[11px] truncate',
                      commandFeedback.ok ? 'text-[#10B981]' : 'text-[#FB7185]',
                    ]"
                  >
                    {{ commandFeedback.text }}
                  </span>
                  <span v-else class="text-[11px] text-[#6B7280] truncate tabular-nums">
                    API {{ openCodeState.capabilities?.discoveredFrom || "v2" }}
                  </span>

                  <button
                    type="submit"
                    :disabled="isSendingPrompt || !commandForm.prompt.trim()"
                    class="px-3.5 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Send class="w-3.5 h-3.5" />
                    <span>{{ isSendingPrompt ? "Enviando..." : "Enviar" }}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          <!-- Bitácora en vivo con historial hidratado e hilos anidados -->
          <div class="flex-1 min-h-0 flex flex-col p-4 space-y-2">
            <div class="flex items-center justify-between gap-2 shrink-0">
              <div class="flex items-center gap-1.5 text-xs text-[#D1D5DB] min-w-0">
                <span class="font-semibold text-[#F3F4F6]">Bitácora en vivo</span>
                <span aria-hidden="true" class="text-[#4B5563]">·</span>
                <span class="text-[11px] text-[#9CA3AF] tabular-nums">
                  {{ sessionLogEntries.length }} eventos
                </span>
                <template v-if="activeLogSessionId">
                  <span aria-hidden="true" class="text-[#4B5563]">·</span>
                  <span class="text-[11px] text-[#6B7280] truncate max-w-[96px] tabular-nums">
                    {{ activeLogSessionId.slice(0, 10) }}
                  </span>
                </template>
              </div>

              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  :disabled="!activeLogSessionId || activeHistoryState.status === 'loading'"
                  @click="handleRefreshSessionHistory"
                  class="px-2 py-1 rounded-md bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-[11px] font-medium text-[#9CA3AF] hover:text-[#F3F4F6] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40"
                >
                  <RefreshCw
                    :class="[
                      'w-3 h-3',
                      activeHistoryState.status === 'loading' ? 'animate-spin text-[#93A8FA]' : '',
                    ]"
                  />
                  <span>Actualizar</span>
                </button>
                <button
                  type="button"
                  :disabled="sessionLogEntries.length === 0"
                  @click="handleClearSessionLog"
                  class="px-2 py-1 rounded-md bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-[11px] font-medium text-[#9CA3AF] hover:text-[#F3F4F6] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40"
                >
                  <Trash2 class="w-3 h-3" />
                  <span>Limpiar</span>
                </button>
              </div>
            </div>

            <div
              ref="logContainerRef"
              class="flex-1 min-h-0 overflow-y-auto rounded-lg bg-[#181B22] border border-white/[0.08] p-2.5 space-y-2"
            >
              <!-- Banner de error recuperable si falló la carga del historial -->
              <div
                v-if="activeHistoryState.status === 'error'"
                class="rounded-lg bg-[#2B141C] border border-[#E11D48]/35 px-3 py-2 flex items-center justify-between gap-2 text-xs text-[#FECDD3]"
              >
                <span class="truncate">
                  {{ activeHistoryState.error || "No se pudo cargar el historial de esta sesión." }}
                </span>
                <button
                  type="button"
                  @click="handleRefreshSessionHistory"
                  class="px-2 py-1 rounded-md bg-[#3A1B26] hover:bg-[#492230] text-[11px] font-medium text-[#FECDD3] cursor-pointer whitespace-nowrap shrink-0"
                >
                  Reintentar historial
                </button>
              </div>

              <!-- Esqueleto de carga al hidratar historial -->
              <div
                v-if="activeHistoryState.status === 'loading' && sessionLogEntries.length === 0"
                class="space-y-2 py-1"
              >
                <div class="h-12 rounded-lg bg-[#1F232D]/80 border border-white/[0.06] animate-pulse"></div>
                <div class="h-8 rounded-lg bg-[#1F232D]/60 border border-white/[0.05] animate-pulse"></div>
                <div class="h-20 rounded-lg bg-[#1F232D]/80 border border-white/[0.06] animate-pulse"></div>
              </div>

              <div
                v-else-if="sessionLogEntries.length === 0 && activeHistoryState.status !== 'error'"
                class="py-8 px-3 text-center text-xs text-[#6B7280] leading-relaxed"
              >
                Sin actividad en esta sesión todavía. Envía una instrucción para ver herramientas, razonamiento plegable y respuesta final en tiempo real.
              </div>

              <template v-for="entry in sessionLogEntries" :key="entry.id">
                <!-- Prompt del usuario -->
                <div
                  v-if="entry.kind === 'prompt'"
                  class="rounded-lg bg-[#1E243B]/75 border border-[#4F6EF7]/25 px-3 py-2 space-y-1"
                >
                  <div class="text-[11px] font-semibold text-[#93A8FA]">
                    Tú · @{{ entry.agentId }}
                  </div>
                  <div class="text-xs text-[#F3F4F6] whitespace-pre-wrap select-text leading-relaxed">
                    {{ entry.content }}
                  </div>
                </div>

                <!-- Razonamiento plegable -->
                <details
                  v-else-if="entry.kind === 'reasoning'"
                  class="rounded-lg bg-[#1F232D] border border-white/[0.06]"
                >
                  <summary class="flex items-center justify-between gap-2 px-3 py-1.5 cursor-pointer text-[11px] text-[#93A8FA] select-none">
                    <span class="flex items-center gap-1.5 min-w-0 truncate">
                      <span class="font-medium">Razonamiento</span>
                      <span aria-hidden="true" class="text-[#4B5563]">·</span>
                      <span class="text-[#D1D5DB]">
                        {{ profileMap[entry.agentId]?.name || entry.agentId }}
                      </span>
                      <span aria-hidden="true" class="text-[#4B5563]">·</span>
                      <span :class="entry.status === 'running' ? 'text-[#93A8FA]' : 'text-[#9CA3AF]'">
                        {{ entry.status === "running" ? "Pensando..." : "Completado" }}
                      </span>
                    </span>
                    <span class="text-[10px] text-[#6B7280] tabular-nums shrink-0">
                      {{ entry.content.length }} chars
                    </span>
                  </summary>
                  <div
                    v-if="entry.content"
                    v-html="renderSafeMarkdown(entry.content)"
                    class="px-3 pb-2.5 pt-2 text-[11px] text-[#D1D5DB] space-y-1.5 border-t border-white/[0.06] max-h-48 overflow-y-auto select-text"
                  ></div>
                  <div
                    v-else
                    class="px-3 pb-2.5 pt-2 text-[11px] text-[#9CA3AF] leading-relaxed border-t border-white/[0.06] select-text"
                  >
                    Analizando problema...
                  </div>
                </details>

                <!-- Hilo anidado desplegable de subagente (delegación subagent / task) -->
                <details
                  v-else-if="entry.kind === 'tool' && entry.isDelegation"
                  @toggle="handleToggleChildThread(entry.childSessionId, $event)"
                  class="rounded-lg bg-[#111318]/90 border border-white/[0.08]"
                >
                  <summary class="flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer text-[11px] select-none">
                    <div class="flex items-center gap-1.5 min-w-0 truncate">
                      <span
                        :class="[
                          'shrink-0 font-semibold',
                          entry.status === 'done'
                            ? 'text-[#10B981]'
                            : entry.status === 'error'
                              ? 'text-[#E11D48]'
                              : 'text-[#4F6EF7]',
                        ]"
                      >
                        {{
                          entry.status === "done"
                            ? "✓"
                            : entry.status === "error"
                              ? "✕"
                              : "…"
                        }}
                      </span>
                      <span class="font-medium text-[#E5E7EB] shrink-0">{{ entry.toolName }}</span>
                      <span
                        v-if="entry.target"
                        class="text-[#9CA3AF] truncate tabular-nums"
                      >
                        · {{ entry.target }}
                      </span>
                    </div>
                    <div class="flex items-center gap-1.5 text-[10px] text-[#6B7280] tabular-nums shrink-0">
                      <span v-if="entry.childSessionId">
                        {{ getChildEntries(entry.childSessionId).length }} pasos
                      </span>
                      <span v-else>
                        {{ profileMap[entry.subagentId || entry.agentId]?.name || entry.subagentId || entry.agentId }}
                      </span>
                      <ChevronDown class="w-3 h-3 text-[#6B7280]" />
                    </div>
                  </summary>

                  <div class="pl-3 pr-2.5 py-2 border-t border-white/[0.06] space-y-1.5">
                    <div
                      v-if="!entry.childSessionId"
                      class="text-[11px] text-[#6B7280] leading-relaxed"
                    >
                      {{
                        entry.status === "running"
                          ? `Esperando vinculación de sub-sesión @${entry.subagentId || "subagent"}...`
                          : "Subtarea ejecutada sin sub-sesión separada registrada."
                      }}
                    </div>

                    <template v-else>
                      <div
                        v-if="getChildHistoryState(entry.childSessionId).status === 'loading' && getChildEntries(entry.childSessionId).length === 0"
                        class="space-y-1.5 py-0.5"
                      >
                        <div class="h-6 rounded bg-[#1F232D]/70 animate-pulse"></div>
                        <div class="h-10 rounded bg-[#1F232D]/70 animate-pulse"></div>
                      </div>

                      <div
                        v-else-if="getChildHistoryState(entry.childSessionId).status === 'error'"
                        class="flex items-center justify-between gap-2 text-[11px] text-[#FECDD3]"
                      >
                        <span class="truncate">No se pudo cargar el hilo del subagente.</span>
                        <button
                          type="button"
                          @click="openCodeBridge.hydrateSessionHistory(entry.childSessionId, { force: true })"
                          class="px-2 py-0.5 rounded bg-[#2B141C] hover:bg-[#3A1B26] border border-[#E11D48]/35 text-[10px] font-medium cursor-pointer whitespace-nowrap"
                        >
                          Reintentar
                        </button>
                      </div>

                      <div
                        v-else-if="getChildEntries(entry.childSessionId).length === 0"
                        class="text-[11px] text-[#6B7280]"
                      >
                        {{
                          entry.status === "running"
                            ? "Subagente iniciando ejecución..."
                            : "Sin pasos detallados registrados en esta sub-sesión."
                        }}
                      </div>

                      <template v-for="subEntry in getChildEntries(entry.childSessionId)" :key="subEntry.id">
                        <details
                          v-if="subEntry.kind === 'reasoning'"
                          class="rounded bg-[#181B22] border border-white/[0.05]"
                        >
                          <summary class="flex items-center justify-between gap-2 px-2 py-1 cursor-pointer text-[10px] text-[#93A8FA] select-none">
                            <span>Razonamiento · {{ subEntry.status === "running" ? "Pensando..." : "Completado" }}</span>
                            <span class="text-[#6B7280] tabular-nums">{{ subEntry.content.length }} chars</span>
                          </summary>
                          <div
                            v-if="subEntry.content"
                            v-html="renderSafeMarkdown(subEntry.content)"
                            class="px-2 pb-2 pt-1.5 text-[11px] text-[#D1D5DB] space-y-1 border-t border-white/[0.05] max-h-40 overflow-y-auto select-text"
                          ></div>
                        </details>

                        <div
                          v-else-if="subEntry.kind === 'tool'"
                          class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#181B22] border border-white/[0.04] text-[10px]"
                        >
                          <div class="flex items-center gap-1.5 min-w-0 truncate">
                            <span
                              :class="[
                                'shrink-0 font-semibold',
                                subEntry.status === 'done'
                                  ? 'text-[#10B981]'
                                  : subEntry.status === 'error'
                                    ? 'text-[#E11D48]'
                                    : 'text-[#4F6EF7]',
                              ]"
                            >
                              {{
                                subEntry.status === "done"
                                  ? "✓"
                                  : subEntry.status === "error"
                                    ? "✕"
                                    : "…"
                              }}
                            </span>
                            <span class="font-medium text-[#E5E7EB] shrink-0">{{ subEntry.toolName }}</span>
                            <span v-if="subEntry.target" class="text-[#9CA3AF] truncate tabular-nums">
                              · {{ subEntry.target }}
                            </span>
                          </div>
                        </div>

                        <div
                          v-else-if="subEntry.kind === 'text' && subEntry.content"
                          v-html="renderSafeMarkdown(subEntry.content)"
                          class="pt-1 text-[11px] text-[#E5E7EB] space-y-1 border-t border-white/[0.05] select-text"
                        ></div>

                        <div
                          v-else-if="subEntry.kind === 'error'"
                          class="px-2 py-1 rounded bg-[#2B141C] border border-[#E11D48]/35 text-[11px] text-[#FECDD3] select-text"
                        >
                          {{ subEntry.content }}
                        </div>
                      </template>
                    </template>
                  </div>
                </details>

                <!-- Línea de herramienta normal -->
                <div
                  v-else-if="entry.kind === 'tool'"
                  class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#111318]/80 border border-white/[0.05] text-[11px]"
                >
                  <div class="flex items-center gap-1.5 min-w-0 truncate">
                    <span
                      :class="[
                        'shrink-0 font-semibold',
                        entry.status === 'done'
                          ? 'text-[#10B981]'
                          : entry.status === 'error'
                            ? 'text-[#E11D48]'
                            : 'text-[#4F6EF7]',
                      ]"
                    >
                      {{
                        entry.status === "done"
                          ? "✓"
                          : entry.status === "error"
                            ? "✕"
                            : "…"
                      }}
                    </span>
                    <span class="font-medium text-[#E5E7EB] shrink-0">{{ entry.toolName }}</span>
                    <span
                      v-if="entry.target"
                      class="text-[#9CA3AF] truncate tabular-nums"
                    >
                      · {{ entry.target }}
                    </span>
                  </div>
                  <span class="text-[10px] text-[#6B7280] shrink-0">
                    {{ profileMap[entry.agentId]?.name || entry.agentId }}
                  </span>
                </div>

                <!-- Respuesta final / texto en vivo -->
                <div
                  v-else-if="entry.kind === 'text'"
                  class="rounded-lg bg-[#1F232D] border border-white/[0.08] px-3 py-2.5 space-y-1.5"
                >
                  <div class="flex items-center gap-1.5 text-[11px] text-[#D1D5DB] font-medium">
                    <span
                      class="w-2 h-2 rounded-[2px] shrink-0"
                      :style="{
                        backgroundColor:
                          profileMap[entry.agentId]?.color || '#4F6EF7',
                      }"
                    ></span>
                    <span>{{ profileMap[entry.agentId]?.name || entry.agentId }}</span>
                    <span aria-hidden="true" class="text-[#4B5563]">·</span>
                    <span :class="entry.status === 'running' ? 'text-[#93A8FA]' : 'text-[#10B981]'">
                      {{ entry.status === "running" ? "Escribiendo..." : "Respuesta" }}
                    </span>
                  </div>
                  <div
                    v-if="entry.content"
                    v-html="renderSafeMarkdown(entry.content)"
                    class="text-xs text-[#F3F4F6] space-y-1.5 select-text"
                  ></div>
                  <div
                    v-else
                    class="text-xs text-[#9CA3AF] leading-relaxed select-text"
                  >
                    Escribiendo respuesta...
                  </div>
                </div>

                <!-- Error -->
                <div
                  v-else
                  class="rounded-lg bg-[#2B141C] border border-[#E11D48]/35 px-3 py-2 text-xs text-[#FECDD3] select-text"
                >
                  {{ entry.content }}
                </div>
              </template>

              <!-- Sub-sesiones hijas vinculadas por parentID sin tarjeta de delegación directa -->
              <template v-for="child in unlinkedChildSessions" :key="child.id">
                <details
                  @toggle="handleToggleChildThread(child.id, $event)"
                  class="rounded-lg bg-[#111318]/90 border border-white/[0.08]"
                >
                  <summary class="flex items-center justify-between gap-2 px-2.5 py-1.5 cursor-pointer text-[11px] select-none">
                    <span class="truncate text-[#D1D5DB]">
                      <span class="font-medium text-[#E5E7EB]">Sub-sesión</span>
                      <span aria-hidden="true" class="text-[#4B5563] mx-1">·</span>
                      <span class="text-[#9CA3AF]">{{ child.title }}</span>
                    </span>
                    <span class="text-[10px] text-[#6B7280] tabular-nums shrink-0">
                      {{ getChildEntries(child.id).length }} pasos
                    </span>
                  </summary>
                  <div class="pl-3 pr-2.5 py-2 border-t border-white/[0.06] space-y-1.5">
                    <div
                      v-if="getChildHistoryState(child.id).status === 'loading' && getChildEntries(child.id).length === 0"
                      class="h-10 rounded bg-[#1F232D]/70 animate-pulse"
                    ></div>
                    <div
                      v-else-if="getChildEntries(child.id).length === 0"
                      class="text-[11px] text-[#6B7280]"
                    >
                      Sin pasos registrados todavía.
                    </div>
                    <template v-for="subEntry in getChildEntries(child.id)" :key="subEntry.id">
                      <div
                        v-if="subEntry.kind === 'tool'"
                        class="flex items-center gap-1.5 px-2 py-1 rounded bg-[#181B22] text-[10px] text-[#D1D5DB] truncate"
                      >
                        <span class="font-medium text-[#E5E7EB]">{{ subEntry.toolName }}</span>
                        <span v-if="subEntry.target" class="text-[#9CA3AF] truncate">· {{ subEntry.target }}</span>
                      </div>
                      <div
                        v-else-if="subEntry.kind === 'text' && subEntry.content"
                        v-html="renderSafeMarkdown(subEntry.content)"
                        class="pt-1 text-[11px] text-[#E5E7EB] space-y-1 select-text"
                      ></div>
                    </template>
                  </div>
                </details>
              </template>
            </div>
          </div>
        </div>

        <!-- Pestaña Conexión -->
        <div
          v-else-if="openCodeTab === 'connection'"
          class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5"
        >
          <div class="space-y-2.5">
            <div class="flex flex-col gap-1">
              <span class="text-[11px] text-[#9CA3AF]">Modo de enlace</span>
              <div
                class="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-[#181B22] border border-white/[0.08]"
              >
                <button
                  type="button"
                  @click="openCodeForm.mode = 'direct'"
                  :class="[
                    'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer',
                    openCodeForm.mode === 'direct'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:text-[#E5E7EB]',
                  ]"
                >
                  Directo :4096
                </button>
                <button
                  type="button"
                  @click="openCodeForm.mode = 'bridge'"
                  :class="[
                    'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer',
                    openCodeForm.mode === 'bridge'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:text-[#E5E7EB]',
                  ]"
                >
                  Puente :4097
                </button>
              </div>
            </div>

            <label class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
              <span>{{
                openCodeForm.mode === "bridge"
                  ? "URL del Puente Local"
                  : "URL de opencode serve"
              }}</span>
              <input
                v-if="openCodeForm.mode === 'direct'"
                v-model="openCodeForm.directUrl"
                type="text"
                placeholder="http://127.0.0.1:4096"
                class="px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7] tabular-nums"
              />
              <input
                v-else
                v-model="openCodeForm.bridgeUrl"
                type="text"
                placeholder="http://127.0.0.1:4097"
                class="px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7] tabular-nums"
              />
            </label>

            <div class="grid grid-cols-3 gap-2">
              <label class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                <span>Usuario</span>
                <input
                  v-model="openCodeForm.username"
                  type="text"
                  placeholder="opencode"
                  class="px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7]"
                />
              </label>

              <label class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                <span>Clave</span>
                <input
                  v-model="openCodeForm.password"
                  type="password"
                  placeholder="••••••"
                  class="px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7]"
                />
              </label>

              <label class="flex flex-col gap-1 text-[11px] text-[#9CA3AF]">
                <span>Cooldown (s)</span>
                <input
                  v-model.number="openCodeForm.idleCooldownSec"
                  type="number"
                  min="5"
                  max="60"
                  class="px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs tabular-nums text-[#F3F4F6] focus:outline-none focus:border-[#4F6EF7]"
                />
              </label>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              @click="handleToggleOpenCodeConnection"
              :class="[
                'px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap',
                openCodeState.status === 'connected' ||
                openCodeState.status === 'connecting'
                  ? 'bg-[#2B141C] hover:bg-[#3A1B26] border border-[#E11D48]/35 text-[#FECDD3]'
                  : 'bg-[#4F6EF7] hover:bg-[#5E7BF8] text-[#F8FAFC]',
              ]"
            >
              <Plug class="w-3.5 h-3.5" />
              <span>{{
                openCodeState.status === "connected" ||
                openCodeState.status === "connecting"
                  ? "Desconectar"
                  : "Conectar"
              }}</span>
            </button>

            <button
              type="button"
              @click="handleTestOpenCodeConnection"
              :disabled="isTestingConnection"
              class="px-3 py-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-xs font-medium text-[#E5E7EB] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              {{ isTestingConnection ? "Probando..." : "Probar conexión" }}
            </button>

            <button
              type="button"
              @click="saveOpenCodeConfig"
              class="px-3 py-1.5 rounded-lg bg-[#181B22] hover:bg-[#252A36] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] transition-colors cursor-pointer whitespace-nowrap"
            >
              Guardar ajuste
            </button>
          </div>

          <div
            class="rounded-lg bg-[#181B22] border border-white/[0.08] px-3 py-2 flex items-center justify-between text-xs text-[#9CA3AF] tabular-nums"
          >
            <span>Eventos: {{ openCodeState.eventsReceived }}</span>
            <span>Sesiones: {{ openCodeState.sessionsCount }}</span>
            <span>En vivo: {{ openCodeState.activeAgents.length }}/5</span>
          </div>

          <div
            v-if="testResult || openCodeState.lastError"
            class="rounded-lg bg-[#181B22] border border-white/[0.08] px-3 py-2.5 text-xs space-y-1"
          >
            <div
              v-if="testResult"
              :class="testResult.ok ? 'text-[#10B981]' : 'text-[#FB7185]'"
            >
              {{
                testResult.ok
                  ? `Servidor accesible (${testResult.latencyMs} ms · ${testResult.sessionsCount} sesiones detectadas)`
                  : `Diagnóstico: ${testResult.error}`
              }}
            </div>
            <div v-if="openCodeState.lastError" class="text-[#FB7185]">
              {{ openCodeState.lastError }}
            </div>
          </div>
        </div>

        <!-- Pestaña Mapeo de 5 Agentes -->
        <div
          v-else-if="openCodeTab === 'mapping'"
          class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
        >
          <div class="space-y-2">
            <div
              v-for="ag in agentList"
              :key="ag.id"
              class="rounded-lg bg-[#181B22] border border-white/[0.08] p-2.5 space-y-1.5"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="w-2.5 h-2.5 rounded-[3px] shrink-0"
                    :style="{ backgroundColor: ag.color }"
                  ></span>
                  <span class="text-xs font-semibold text-[#F3F4F6] truncate">
                    {{ ag.name }}
                  </span>
                  <span class="text-[11px] text-[#6B7280]">({{ ag.id }})</span>
                </div>
                <span
                  :class="[
                    'text-[11px] font-medium shrink-0',
                    openCodeState.activeAgents.includes(ag.id)
                      ? 'text-[#10B981]'
                      : 'text-[#6B7280]',
                  ]"
                >
                  {{
                    openCodeState.activeAgents.includes(ag.id)
                      ? "En vivo"
                      : "Autónomo"
                  }}
                </span>
              </div>
              <input
                v-model="aliasDraft[ag.id]"
                type="text"
                placeholder="alias1, alias2"
                class="w-full px-2.5 py-1.5 rounded-md bg-[#111318] border border-white/[0.08] text-xs text-[#E5E7EB] focus:outline-none focus:border-[#4F6EF7]"
              />
            </div>
          </div>

          <p class="text-[11px] text-[#9CA3AF] leading-relaxed">
            Resuelve eventos por <span>part.agent</span>, subagentes <span>task</span>, sesión hija <span>parentID</span> o alias separados por coma.
          </p>

          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="handleSaveAliases"
              class="px-3.5 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] transition-colors cursor-pointer whitespace-nowrap"
            >
              Guardar alias
            </button>
            <button
              type="button"
              @click="handleResetAliases"
              class="px-3 py-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] transition-colors cursor-pointer whitespace-nowrap"
            >
              Restaurar
            </button>
          </div>
        </div>

        <!-- Pestaña Guía y Plantilla opencode.json -->
        <div
          v-else
          class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3.5 text-xs text-[#D1D5DB]"
        >
          <div class="space-y-2">
            <p class="font-semibold text-[#F3F4F6]">
              Cómo conectar tu OpenCode paso a paso:
            </p>
            <ol class="space-y-1.5 list-decimal list-inside text-[#D1D5DB] leading-relaxed">
              <li>
                Copia la plantilla <span class="text-[#93A8FA]">opencode.json</span> en la raíz del proyecto o en <span class="text-[#F3F4F6]">~/.config/opencode/opencode.json</span>.
              </li>
              <li>
                Inicia el servidor local de OpenCode con CORS habilitado (o el puente en el puerto 4097).
              </li>
              <li>
                Conecta tu TUI con <span class="text-[#93A8FA]">opencode attach</span> y delega tareas desde <span class="text-[#F3F4F6]">architect</span> hacia <span class="text-[#F3F4F6]">@frontend</span>, <span class="text-[#F3F4F6]">@backend</span>, <span class="text-[#F3F4F6]">@qa</span> o <span class="text-[#F3F4F6]">@systems</span>.
              </li>
              <li>
                Pulsa <strong>Conectar</strong> en Conexión; cada agente activo irá a su escritorio tras la reunión de delegación.
              </li>
            </ol>
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2 rounded-lg bg-[#181B22] border border-white/[0.08] px-2.5 py-2">
              <span class="text-[11px] text-[#93A8FA] truncate select-text">
                {{ OPENCODE_CLI_COMMANDS.serveDirect }}
              </span>
              <button
                type="button"
                @click="copySnippet('serve', OPENCODE_CLI_COMMANDS.serveDirect)"
                class="px-2 py-1 rounded-md bg-[#1F232D] hover:bg-[#272D3B] text-[11px] text-[#E5E7EB] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Check v-if="copiedKey === 'serve'" class="w-3 h-3 text-[#10B981]" />
                <Copy v-else class="w-3 h-3" />
                <span>{{ copiedKey === "serve" ? "Copiado" : "Copiar" }}</span>
              </button>
            </div>

            <div class="flex items-center justify-between gap-2 rounded-lg bg-[#181B22] border border-white/[0.08] px-2.5 py-2">
              <span class="text-[11px] text-[#D1D5DB] truncate select-text">
                {{ OPENCODE_CLI_COMMANDS.runBridge }} · {{ OPENCODE_CLI_COMMANDS.attachTui }}
              </span>
              <button
                type="button"
                @click="copySnippet('bridge', OPENCODE_CLI_COMMANDS.runBridge)"
                class="px-2 py-1 rounded-md bg-[#1F232D] hover:bg-[#272D3B] text-[11px] text-[#E5E7EB] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Check v-if="copiedKey === 'bridge'" class="w-3 h-3 text-[#10B981]" />
                <Copy v-else class="w-3 h-3" />
                <span>{{ copiedKey === "bridge" ? "Copiado" : "Puente" }}</span>
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-1.5">
              <span class="font-medium text-[#E5E7EB]">Plantilla opencode.json</span>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  @click="downloadOpenCodeReport"
                  class="px-2 py-1 rounded-md bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-[11px] font-medium text-[#E5E7EB] flex items-center gap-1 cursor-pointer"
                >
                  <Download class="w-3 h-3" />
                  <span>Guía .md</span>
                </button>
                <button
                  type="button"
                  @click="downloadOpenCodeJson"
                  class="px-2 py-1 rounded-md bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-[11px] font-medium text-[#E5E7EB] flex items-center gap-1 cursor-pointer"
                >
                  <Download class="w-3 h-3" />
                  <span>.json</span>
                </button>
                <button
                  type="button"
                  @click="copySnippet('json', OPENCODE_JSON_SNIPPET)"
                  class="px-2.5 py-1 rounded-md bg-[#4F6EF7] hover:bg-[#5E7BF8] text-[11px] font-medium text-[#F8FAFC] flex items-center gap-1 cursor-pointer"
                >
                  <Check v-if="copiedKey === 'json'" class="w-3 h-3" />
                  <Copy v-else class="w-3 h-3" />
                  <span>{{ copiedKey === "json" ? "Copiado" : "Copiar JSON" }}</span>
                </button>
              </div>
            </div>
            <pre
              class="rounded-lg bg-[#181B22] border border-white/[0.08] p-3 text-[11px] text-[#D1D5DB] overflow-auto max-h-56 leading-relaxed select-text"
            >{{ OPENCODE_JSON_SNIPPET }}</pre>
          </div>
        </div>
      </aside>
    </transition>

    <!-- ZONA 4B: Modal Amplio Centrado del Tablero Kanban -->
    <transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isReady && isTaskBoardOpen"
        @click.self="isTaskBoardOpen = false"
        class="fixed inset-0 z-40 bg-[#090B0E]/75 flex items-center justify-center p-4 sm:p-6 pointer-events-auto"
      >
        <div
          class="w-[min(1200px,95vw)] max-h-[88vh] rounded-xl bg-[#111318] border border-white/[0.08] flex flex-col overflow-hidden"
        >
          <!-- Cabecera Modal Kanban -->
          <div
            class="px-5 py-3.5 border-b border-white/[0.08] bg-[#181B22] flex flex-wrap items-center justify-between gap-3 shrink-0"
          >
            <div class="flex items-center gap-2.5 text-sm font-semibold text-[#F3F4F6]">
              <ListTodo class="w-4 h-4 text-[#4F6EF7]" />
              <span>Tablero de Tareas (Sprint)</span>
              <span aria-hidden="true" class="text-[#4B5563]">·</span>
              <span class="text-xs font-normal text-[#9CA3AF] tabular-nums">
                {{ tasks.length }} tareas
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <!-- Filtro rápido de origen -->
              <div
                class="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#111318] border border-white/[0.08]"
              >
                <button
                  type="button"
                  @click="taskSourceFilter = 'all'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    taskSourceFilter === 'all'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:text-[#E5E7EB]',
                  ]"
                >
                  Todas
                </button>
                <button
                  type="button"
                  @click="taskSourceFilter = 'opencode'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    taskSourceFilter === 'opencode'
                      ? 'bg-[#1E243B] text-[#93A8FA]'
                      : 'text-[#9CA3AF] hover:text-[#E5E7EB]',
                  ]"
                >
                  OpenCode
                </button>
                <button
                  type="button"
                  @click="taskSourceFilter = 'manual'"
                  :class="[
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                    taskSourceFilter === 'manual'
                      ? 'bg-[#252A36] text-[#F3F4F6]'
                      : 'text-[#9CA3AF] hover:text-[#E5E7EB]',
                  ]"
                >
                  Manuales
                </button>
              </div>

              <button
                type="button"
                :disabled="demoTasksCount === 0"
                @click="handleClearDemoTasks"
                class="px-2.5 py-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40"
              >
                Limpiar demo
              </button>
              <button
                type="button"
                @click="taskBoardManager.clearDoneTasks()"
                class="px-2.5 py-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] transition-colors cursor-pointer whitespace-nowrap"
              >
                Limpiar completadas
              </button>
              <button
                type="button"
                @click="taskBoardManager.resetTasks()"
                class="px-2.5 py-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-xs font-medium text-[#D1D5DB] transition-colors cursor-pointer whitespace-nowrap"
              >
                Restaurar demo
              </button>
              <button
                type="button"
                @click="isTaskBoardOpen = false"
                aria-label="Cerrar tablero"
                class="p-1.5 rounded-lg bg-[#1F232D] hover:bg-[#272D3B] border border-white/[0.08] text-[#9CA3AF] hover:text-[#F3F4F6] transition-colors cursor-pointer"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Alta rápida de tarea -->
          <form
            @submit.prevent="handleCreateTask"
            class="px-5 py-3 border-b border-white/[0.08] grid grid-cols-1 sm:grid-cols-12 gap-2 shrink-0"
          >
            <input
              v-model="newTask.title"
              type="text"
              maxlength="48"
              placeholder="Nueva tarea (ej. Optimizar sombras PBR)"
              class="sm:col-span-4 px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#F3F4F6] placeholder:text-[#6B7280] focus:outline-none focus:border-[#4F6EF7]"
            />
            <input
              v-model="newTask.file"
              type="text"
              maxlength="42"
              placeholder="Archivo (ej. src/webgl/World.js)"
              class="sm:col-span-3 px-3 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#E5E7EB] placeholder:text-[#6B7280] focus:outline-none focus:border-[#4F6EF7]"
            />
            <select
              v-model="newTask.assigneeId"
              class="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#E5E7EB] focus:outline-none focus:border-[#4F6EF7]"
            >
              <option
                v-for="ag in agentList"
                :key="ag.id"
                :value="ag.id"
              >
                {{ ag.name }}
              </option>
            </select>
            <select
              v-model="newTask.status"
              class="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-[#181B22] border border-white/[0.08] text-xs text-[#E5E7EB] focus:outline-none focus:border-[#4F6EF7]"
            >
              <option
                v-for="col in TASK_COLUMNS"
                :key="col.id"
                :value="col.id"
              >
                {{ col.label }}
              </option>
            </select>
            <button
              type="submit"
              class="sm:col-span-1 px-3 py-1.5 rounded-lg bg-[#4F6EF7] hover:bg-[#5E7BF8] text-xs font-medium text-[#F8FAFC] flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus class="w-3.5 h-3.5" />
              <span>Crear</span>
            </button>
          </form>

          <!-- 5 Columnas Kanban -->
          <div class="flex-1 min-h-0 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-5 gap-3">
            <div
              v-for="col in TASK_COLUMNS"
              :key="col.id"
              class="rounded-xl bg-[#181B22] border border-white/[0.08] p-3 flex flex-col gap-2.5 min-h-[280px]"
            >
              <div class="flex items-center justify-between text-xs font-semibold pb-1.5 border-b border-white/[0.06]">
                <div class="flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-[2px] shrink-0"
                    :style="{ backgroundColor: col.hex }"
                  ></span>
                  <span :class="col.accent">{{ col.label }}</span>
                </div>
                <span class="text-[#9CA3AF] tabular-nums">
                  {{ taskCountByStatus[col.id] }}
                </span>
              </div>

              <div class="space-y-2">
                <div
                  v-for="task in filteredTasks.filter((t) => t.status === col.id)"
                  :key="task.id"
                  class="rounded-lg bg-[#1F232D] border border-white/[0.08] p-2.5 space-y-2"
                >
                  <div class="flex items-start justify-between gap-2">
                    <p class="text-xs font-medium text-[#F3F4F6] leading-snug">
                      {{ task.title }}
                    </p>
                    <button
                      type="button"
                      @click="handleDeleteTask(task.id)"
                      aria-label="Eliminar tarea"
                      class="text-[#6B7280] hover:text-[#FB7185] transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div class="text-[11px] text-[#9CA3AF] truncate tabular-nums">
                    {{ task.file }}
                  </div>

                  <div class="flex items-center justify-between gap-2 pt-0.5">
                    <button
                      type="button"
                      @click="
                        selectAgentFromDock(task.assigneeId);
                        isTaskBoardOpen = false;
                      "
                      class="flex items-center gap-1.5 text-[11px] text-[#D1D5DB] hover:text-[#F3F4F6] cursor-pointer truncate"
                    >
                      <span
                        class="w-2 h-2 rounded-[2px] shrink-0"
                        :style="{
                          backgroundColor:
                            profileMap[task.assigneeId]?.color || '#6B7280',
                        }"
                      ></span>
                      <span class="truncate">{{
                        profileMap[task.assigneeId]?.name || task.assigneeId
                      }}</span>
                      <span
                        v-if="task.source === 'opencode'"
                        class="text-[10px] font-medium text-[#93A8FA] shrink-0"
                      >
                        · OpenCode
                      </span>
                      <span
                        v-else-if="task.source === 'demo'"
                        class="text-[10px] text-[#6B7280] shrink-0"
                      >
                        · Demo
                      </span>
                    </button>

                    <select
                      :value="task.status"
                      @change="handleMoveTask(task.id, $event.target.value)"
                      aria-label="Cambiar estado de tarea"
                      class="px-1.5 py-0.5 rounded-md bg-[#111318] border border-white/[0.08] text-[10px] text-[#D1D5DB] focus:outline-none focus:border-[#4F6EF7] cursor-pointer"
                    >
                      <option
                        v-for="opt in TASK_COLUMNS"
                        :key="opt.id"
                        :value="opt.id"
                      >
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </main>
</template>
