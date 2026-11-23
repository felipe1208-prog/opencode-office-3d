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
  ChevronDown,
  Crosshair,
  X,
  RotateCcw,
  MessageSquare,
  Plus,
  Copy,
  Check,
  Plug,
  Download,
  Send,
  Square,
  ShieldAlert,
  AlertTriangle,
  SlidersHorizontal,
  Volume2,
  Volume1,
  VolumeX,
  GitBranch,
  FolderOpen,
  Bell,
  RefreshCw,
  Activity,
  CheckCircle2,
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
} from "./state/officeWorkspace";
import { openCodeBridge } from "./opencode/OpenCodeBridgeClient";
import { ambientAudio } from "./audio/AmbientAudioEngine";
import {
  OPENCODE_JSON_SNIPPET,
  OPENCODE_CLI_COMMANDS,
  buildOpenCodeSetupReport,
} from "./opencode/openCodeTemplates";
import { renderSafeMarkdown } from "./utils/safeMarkdown";
import GitActivityInspectorModal from "./components/GitActivityInspectorModal.vue";
import WhiteboardModal from "./components/WhiteboardModal.vue";
import QuickStandupModal from "./components/QuickStandupModal.vue";

const canvasRef = ref(null);
const loadProgress = ref(0);
const isReady = ref(false);
const isOverviewCamera = ref(true);
const selectedAgentId = ref(null);

const isChatOpen = ref(false);
const isSettingsModalOpen = ref(false);
const settingsTab = ref("connection"); // 'connection' | 'workspace' | 'mapping' | 'guide'

const hoveredProp = ref(null);
const isInspectorOpen = ref(false);
const inspectorInitialTab = ref("git");
const inspectorAgentId = ref("all");
const isWhiteboardOpen = ref(false);
const whiteboardNotes = ref([]);
const isStandupOpen = ref(false);

const workspaceSummary = ref(null);
const workspaceDirInput = ref("");
const workspaceDirFeedback = ref(null);
const isApplyingWorkspaceDir = ref(false);
const toolActivityList = ref([]);
const bridgeDiagnostics = ref(null);
const isLoadingDiagnostics = ref(false);
const showDiagErrors = ref(false);
const retryingEntryId = ref(null);

const audioMode = ref(ambientAudio.getMode());
const DESKTOP_NOTIF_KEY = "oficina3d:desktop_notifications:v1";
function readDesktopNotifPref() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DESKTOP_NOTIF_KEY) === "1";
  } catch {
    return false;
  }
}
const desktopNotifEnabled = ref(readDesktopNotifPref());
const desktopNotifPermission = ref(
  typeof Notification !== "undefined" ? Notification.permission : "unsupported",
);
const notifiedAttentionIds = new Set();

const profiles = ref(agentProfileManager.getProfiles());
const profileDrafts = reactive(
  Object.fromEntries(
    profiles.value.map((p) => [
      p.id,
      { name: p.name, role: p.role, color: p.color },
    ]),
  ),
);
const tasks = ref(taskBoardManager.getTasks());
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
  autoConnect: Boolean(initialOpenCodeCfg.autoConnect),
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

const agentSnapshots = reactive({});

const agentList = computed(() => profiles.value);

const profileMap = computed(() =>
  Object.fromEntries(profiles.value.map((p) => [p.id, p])),
);

const pendingPermissions = computed(
  () => openCodeState.value.pendingPermissions || [],
);

const pendingQuestions = computed(
  () => openCodeState.value.pendingQuestions || [],
);

const pendingInquiries = computed(
  () => openCodeState.value.pendingInquiries || [],
);

const activePermission = computed(() => pendingPermissions.value[0] || null);

const activeLogSessionId = computed(() => {
  if (commandForm.sessionId) return commandForm.sessionId;
  const preferred =
    openCodeState.value.agentThreads?.[commandForm.agent]?.sessionId;
  if (preferred) return preferred;
  if (commandForm.agent === "architect") {
    return openCodeState.value.activeSessionId || "";
  }
  return "";
});

const currentThreadQuestion = computed(() => {
  const currentAgent = commandForm.agent || "architect";
  const sid = activeLogSessionId.value;
  return (
    pendingQuestions.value.find(
      (q) => q.agentId === currentAgent || (sid && q.sessionID === sid),
    ) || null
  );
});

const toastQuestion = computed(() => {
  if (!pendingQuestions.value.length) return null;
  if (!isChatOpen.value) return pendingQuestions.value[0];
  const currentAgent = commandForm.agent || "architect";
  return pendingQuestions.value.find((q) => q.agentId !== currentAgent) || null;
});

const toastInquiry = computed(() => {
  if (!pendingInquiries.value.length) return null;
  const currentAgent = commandForm.agent || "architect";
  const blockedAgent = toastQuestion.value?.agentId || null;
  return (
    pendingInquiries.value.find((inq) => {
      if (blockedAgent && inq.agentId === blockedAgent) return false;
      if (!isChatOpen.value) return true;
      return inq.agentId !== currentAgent;
    }) || null
  );
});

const pendingAttentionCount = computed(
  () =>
    pendingPermissions.value.length +
    pendingQuestions.value.length +
    pendingInquiries.value.length,
);

const blockedCliAlerts = computed(() => {
  const permSessions = new Set(
    pendingPermissions.value.map((p) => p.sessionID).filter(Boolean),
  );
  const questionSessions = new Set(
    pendingQuestions.value.map((q) => q.sessionID).filter(Boolean),
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

const visibleChatEntries = computed(() =>
  sessionLogEntries.value.filter((entry) => {
    if (!entry) return false;
    if (entry.kind === "reasoning") return false;
    if (entry.kind === "tool" && !entry.isDelegation) return false;
    return true;
  }),
);

const isChatBusy = computed(() => {
  if (isSendingPrompt.value || isInterrupting.value) return true;
  const sid = activeLogSessionId.value;
  if (sid && openCodeState.value && openCodeBridge.busySessions?.has(sid)) {
    return true;
  }
  if (
    openCodeState.value.agentThreads?.[commandForm.agent]?.isBusy &&
    (!sid || openCodeState.value.agentThreads?.[commandForm.agent]?.sessionId === sid)
  ) {
    return true;
  }
  if (
    sessionLogEntries.value.some(
      (e) =>
        e.status === "running" &&
        (e.kind === "text" || e.kind === "prompt" || e.isDelegation),
    )
  ) {
    return true;
  }
  return false;
});

const showTypingIndicator = computed(() => {
  if (!isChatBusy.value) return false;
  const last = visibleChatEntries.value[visibleChatEntries.value.length - 1];
  if (last && last.kind === "text" && last.status === "running") {
    return false;
  }
  return true;
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
        state: "WORKING",
        animation: "typing",
        actionLabel: "Trabajando en su escritorio",
        taskTitle: null,
        zone: "dev-area",
        checkpointId: fallback.checkpointId,
      }
    : null;
});

const selectedHumanState = computed(() =>
  formatHumanAgentState(selectedSnapshot.value),
);

const selectedHumanTaskSummary = computed(() =>
  getAgentHumanTaskSummary(selectedSnapshot.value),
);

let experience = null;
let unsubProfileSync = null;
let unsubTaskSync = null;
let unsubOpenCode = null;
let unsubSessionLog = null;
let unsubToolActivity = null;
let unsubWorkspace = null;
let unsubWhiteboard = null;
let unsubAudioChange = null;
let copyFeedbackTimer = null;

const BASE_DOC_TITLE = "Oficina Virtual 3D";

watch(
  pendingAttentionCount,
  (count) => {
    if (typeof document !== "undefined") {
      document.title = count > 0 ? `(${count}) ${BASE_DOC_TITLE}` : BASE_DOC_TITLE;
    }
  },
  { immediate: true },
);

function dispatchDesktopNotification({ id, title, body, agentId = "architect" }) {
  if (!desktopNotifEnabled.value) return;
  if (typeof document === "undefined" || !document.hidden) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!id || notifiedAttentionIds.has(id)) return;
  notifiedAttentionIds.add(id);
  try {
    const n = new Notification(title, {
      body: String(body || "").slice(0, 140),
      tag: id,
    });
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        // Ignorar restricciones del navegador
      }
      selectChatAgent(agentId, { focus3d: true, openDrawer: true });
      n.close();
    };
  } catch {
    // Ignorar fallo si el navegador bloquea notificaciones en iframe
  }
}

watch(
  [pendingPermissions, pendingQuestions, pendingInquiries],
  ([perms, questions, inquiries]) => {
    for (const p of perms) {
      const name = profileMap.value[p.agentId]?.name || p.agentId || "Equipo";
      dispatchDesktopNotification({
        id: `perm:${p.id}`,
        title: `Permiso solicitado · ${name}`,
        body: `${p.title || "Autorización"}: ${p.targetSummary || ""}`,
        agentId: p.agentId || "architect",
      });
    }
    for (const q of questions) {
      const name = profileMap.value[q.agentId]?.name || q.agentId || "Equipo";
      dispatchDesktopNotification({
        id: `q:${q.id}`,
        title: `${name} te hace una consulta`,
        body: q.questions?.[0]?.question || "Esperando tu respuesta",
        agentId: q.agentId || "architect",
      });
    }
    for (const inq of inquiries) {
      const name = profileMap.value[inq.agentId]?.name || inq.agentId || "Equipo";
      dispatchDesktopNotification({
        id: `inq:${inq.id}`,
        title: inq.isEscalation
          ? `Límite de revisión automática · ${name}`
          : `${name} te hace una consulta`,
        body: inq.excerpt || "Consulta pendiente en el chat",
        agentId: inq.agentId || "architect",
      });
    }
  },
  { deep: false },
);

const audioModeLabel = computed(() => {
  if (audioMode.value === "ambient") return "Audio: Ambiente y avisos";
  if (audioMode.value === "muted") return "Audio: Silenciado";
  return "Audio: Solo avisos sutiles";
});

const workspaceChangedCount = computed(() =>
  Array.isArray(workspaceSummary.value?.changes)
    ? workspaceSummary.value.changes.length
    : 0,
);

const anyFloatingModalOpen = computed(
  () =>
    isSettingsModalOpen.value ||
    isInspectorOpen.value ||
    isWhiteboardOpen.value ||
    isStandupOpen.value,
);

const hoverTooltipStyle = computed(() => {
  if (!hoveredProp.value) return {};
  const maxW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const x = Math.min((hoveredProp.value.clientX || 0) + 14, maxW - 240);
  const y = Math.max((hoveredProp.value.clientY || 0) - 12, 12);
  return {
    transform: `translate3d(${x}px, ${y}px, 0)`,
  };
});

function hexToRgba(hex, alpha = 0.14) {
  const clean = String(hex || "#E09F5A").replace("#", "");
  if (clean.length !== 6) return `rgba(224, 159, 90, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getAgentChipStyle(agent) {
  const isSelected = selectedAgentId.value === agent.id;
  if (isSelected) {
    return {
      backgroundColor: hexToRgba(agent.color, 0.2),
      borderColor: hexToRgba(agent.color, 0.52),
    };
  }
  return {};
}

function getAgentThreadInfo(agentId) {
  return (
    openCodeState.value.agentThreads?.[agentId] || {
      agentId,
      sessionId: null,
      isBusy: false,
      pendingQuestionsCount: 0,
      pendingInquiriesCount: 0,
      hasAttention: false,
    }
  );
}

function hasAgentAttention(agentId) {
  if (!agentId) return false;
  if (getAgentThreadInfo(agentId).hasAttention) return true;
  if (pendingPermissions.value.some((p) => p.agentId === agentId)) {
    return true;
  }
  return false;
}

function formatMemberOptionLabel(agent) {
  if (!agent) return "";
  if (hasAgentAttention(agent.id)) {
    return `${agent.name} · consulta`;
  }
  if (
    getAgentThreadInfo(agent.id).isBusy ||
    openCodeState.value.activeAgents.includes(agent.id)
  ) {
    return `${agent.name} · trabajando`;
  }
  return agent.name;
}

function formatHumanAgentState(snap) {
  if (!snap) return "Disponible";

  const hasQuestion =
    pendingQuestions.value.some((q) => q.agentId === snap.id) ||
    pendingInquiries.value.some((inq) => inq.agentId === snap.id);
  if (hasQuestion) return "Esperando tu respuesta";

  const hasPermission = pendingPermissions.value.some(
    (p) => p.agentId === snap.id,
  );
  if (hasPermission) return "Esperando autorización";

  if (snap.socialMode === "PAIR_CHAT") {
    if (snap.state === "TRAVELING") return "Yendo a conversar";
    return snap.socialPartnerName
      ? `Conversando con ${snap.socialPartnerName}`
      : "Conversando en el lounge";
  }

  if (snap.socialMode === "DESK_REVIEW") {
    if (snap.state === "TRAVELING") return "Yendo a revisar código";
    return snap.socialPartnerName
      ? `Revisando con ${snap.socialPartnerName}`
      : "Revisando código";
  }

  if (snap.socialMode === "MEETING") {
    return snap.state === "TRAVELING"
      ? "Yendo a la sala de reuniones"
      : "En reunión de equipo";
  }

  const cp = String(snap.checkpointId || "");
  if (snap.state === "INTERACTING") {
    if (cp.includes("espresso") || cp.includes("barstool")) {
      return "Tomando café";
    }
    if (cp.includes("water")) return "Tomando agua";
    if (cp.includes("fridge")) return "En la cocina";
    if (cp.includes("lounge")) return "Descansando en el lounge";
    if (cp.includes("pingpong")) return "Jugando ping-pong";
    if (cp.includes("arcade")) return "En la zona arcade";
    if (cp.includes("bookcase")) return "Consultando documentación";
    if (cp.includes("meeting")) return "En sala de reuniones";
    return "Haciendo una pausa";
  }

  if (snap.state === "TRAVELING") return "Caminando por la oficina";
  if (snap.state === "WAITING") return "Esperando turno";
  if (snap.state === "THINKING") return "Analizando arquitectura";
  if (snap.state === "WORKING") {
    return openCodeState.value.activeAgents.includes(snap.id)
      ? "Trabajando activamente"
      : "Trabajando en su escritorio";
  }

  return "Disponible";
}

function getAgentHumanTaskSummary(snap) {
  if (!snap) return "Disponible";

  const pendingQ = pendingQuestions.value.find((q) => q.agentId === snap.id);
  if (pendingQ?.questions?.[0]?.question) {
    return pendingQ.questions[0].question;
  }

  const pendingInq = pendingInquiries.value.find(
    (inq) => inq.agentId === snap.id,
  );
  if (pendingInq?.excerpt) {
    return pendingInq.excerpt;
  }

  const taskText = String(snap.taskTitle || "").trim();
  const genericPhrases = new Set([
    "Tecleando código",
    "Disponible",
    "Desplazándose por oficina",
    "En escritorio",
    "Procesando prompt OpenCode",
  ]);
  if (taskText && !genericPhrases.has(taskText)) {
    return taskText;
  }

  const liveTask = tasks.value.find(
    (t) =>
      t.source === "opencode" &&
      t.assigneeId === snap.id &&
      (t.status === "in_progress" || t.status === "blocked"),
  );
  if (liveTask?.title && !genericPhrases.has(liveTask.title)) {
    return liveTask.title;
  }

  if (
    openCodeState.value.activeAgents.includes(snap.id) &&
    snap.actionLabel &&
    !genericPhrases.has(snap.actionLabel)
  ) {
    return snap.actionLabel;
  }

  return "Disponible";
}

function formatDelegationTitle(entry) {
  const hostName = profileMap.value[entry.agentId]?.name || "El equipo";
  const targetName = entry.subagentId
    ? profileMap.value[entry.subagentId]?.name || entry.subagentId
    : null;
  if (targetName && targetName !== hostName) {
    return `${hostName} consultó con ${targetName}`;
  }
  return entry.target
    ? `${hostName} · ${entry.target}`
    : `${hostName} · Subtarea`;
}

function scrollLogToBottom(force = false) {
  const el = logContainerRef.value;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
  if (force || nearBottom) {
    el.scrollTop = el.scrollHeight;
  }
}

function initQuestionDraft(item, prevId = null) {
  if (!item?.id) return null;
  const questions = Array.isArray(item.questions) ? item.questions : [];
  const existing = questionDrafts[item.id];
  if (!Array.isArray(existing) || existing.length !== questions.length) {
    const sourceDraft = Array.isArray(existing)
      ? existing
      : prevId && Array.isArray(questionDrafts[prevId])
        ? questionDrafts[prevId]
        : null;
    questionDrafts[item.id] = questions.map((_, idx) => {
      const prevSlot = sourceDraft?.[idx];
      return {
        selected: Array.isArray(prevSlot?.selected)
          ? [...prevSlot.selected]
          : [],
        custom: String(prevSlot?.custom || ""),
      };
    });
  }
  return questionDrafts[item.id];
}

watch(
  () => [
    currentThreadQuestion.value?.id,
    currentThreadQuestion.value?.questions?.length || 0,
  ],
  ([newId], [oldId] = []) => {
    const item = currentThreadQuestion.value;
    if (item && newId) {
      initQuestionDraft(item, oldId && oldId !== newId ? oldId : null);
    } else {
      questionError.value = null;
    }
  },
  { immediate: true },
);

watch(
  [isChatOpen, () => commandForm.agent, activeLogSessionId],
  ([chatOpen, agentId, sessionId]) => {
    openCodeBridge.setViewedThread({
      agentId,
      sessionId: sessionId || null,
      chatOpen,
    });
    if (chatOpen) {
      nextTick(() => scrollLogToBottom(true));
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

watch(activeLogSessionId, (sid) => {
  syncSessionLogView();
  if (sid && openCodeState.value.status === "connected") {
    const histStatus =
      openCodeState.value.sessionHistoryStates?.[sid]?.status;
    if (!histStatus || histStatus === "idle") {
      openCodeBridge.hydrateSessionHistory(sid);
    }
    openCodeBridge.syncPendingQuestions(sid);
  }
  nextTick(() => scrollLogToBottom(true));
});

function syncAliasDraft(cfg = openCodeBridge.getConfig()) {
  for (const [id, list] of Object.entries(cfg.aliases)) {
    aliasDraft[id] = list.join(", ");
  }
}

function syncProfileDrafts(list = profiles.value) {
  for (const p of list) {
    profileDrafts[p.id] = {
      name: p.name,
      role: p.role,
      color: p.color,
    };
  }
}

function handleCycleAudioMode() {
  ambientAudio.cycleMode();
}

function handleSetAudioMode(mode) {
  ambientAudio.setMode(mode);
}

async function handleToggleDesktopNotifications() {
  if (typeof Notification === "undefined") {
    desktopNotifPermission.value = "unsupported";
    desktopNotifEnabled.value = false;
    return;
  }
  if (!desktopNotifEnabled.value) {
    if (Notification.permission === "default") {
      try {
        const res = await Notification.requestPermission();
        desktopNotifPermission.value = res;
        if (res !== "granted") {
          desktopNotifEnabled.value = false;
          return;
        }
      } catch {
        desktopNotifEnabled.value = false;
        return;
      }
    } else if (Notification.permission !== "granted") {
      desktopNotifPermission.value = Notification.permission;
      desktopNotifEnabled.value = false;
      return;
    }
    desktopNotifEnabled.value = true;
  } else {
    desktopNotifEnabled.value = false;
  }
  try {
    localStorage.setItem(DESKTOP_NOTIF_KEY, desktopNotifEnabled.value ? "1" : "0");
  } catch {
    // Ignorar error de almacenamiento
  }
}

function openInspectorModal({ tab = "git", agentId = "all" } = {}) {
  hoveredProp.value = null;
  inspectorInitialTab.value = tab;
  inspectorAgentId.value = agentId || "all";
  toolActivityList.value = openCodeBridge.getToolActivity("all");
  isInspectorOpen.value = true;
}

function openWhiteboardModal() {
  hoveredProp.value = null;
  isWhiteboardOpen.value = true;
}

function openStandupModal() {
  hoveredProp.value = null;
  isStandupOpen.value = true;
}

function handlePropSelected(propHit) {
  if (!propHit) return;
  hoveredProp.value = null;
  if (propHit.propKind === "whiteboard") {
    openWhiteboardModal();
  } else if (propHit.propKind === "meeting-table") {
    openStandupModal();
  } else if (propHit.propKind === "monitor") {
    const agentAct = openCodeBridge.getToolActivity(propHit.agentId || "all");
    const defaultTab =
      workspaceChangedCount.value === 0 && agentAct.length > 0 ? "activity" : "git";
    openInspectorModal({
      tab: defaultTab,
      agentId: propHit.agentId || "all",
    });
  }
}

async function handleLaunchStandup({ topic, prompt }) {
  isStandupOpen.value = false;
  experience?.triggerTeamMeeting(topic || "Standup de equipo");
  if (openCodeState.value.status === "connected" && prompt) {
    selectChatAgent("architect", { focus3d: false, openDrawer: true });
    commandForm.prompt = prompt;
    await handleSendOpenCodePrompt();
  }
}

async function handleInspectorDispatchPrompt({
  agentId = "qa",
  prompt = "",
  openChat = true,
} = {}) {
  if (!prompt || openCodeState.value.status !== "connected") return;
  isInspectorOpen.value = false;
  selectChatAgent(agentId || "qa", {
    focus3d: true,
    openDrawer: Boolean(openChat),
  });
  commandForm.prompt = prompt;
  await handleSendOpenCodePrompt();
}

async function handleApplyWorkspaceDir() {
  const dir = workspaceDirInput.value.trim();
  if (!dir || isApplyingWorkspaceDir.value) return;
  isApplyingWorkspaceDir.value = true;
  workspaceDirFeedback.value = null;
  const res = await openCodeBridge.setWorkspaceDirectory(dir);
  isApplyingWorkspaceDir.value = false;
  if (res.ok) {
    workspaceSummary.value = res;
    workspaceDirInput.value = res.projectDir || dir;
    workspaceDirFeedback.value = {
      ok: true,
      text: res.isGitRepo
        ? `Proyecto activo: ${res.projectName} (rama ${res.branch || "HEAD"})`
        : `Carpeta activa actualizada: ${res.projectName}`,
    };
    handleRefreshDiagnostics();
  } else {
    workspaceDirFeedback.value = {
      ok: false,
      text: res.error || "No se pudo cambiar la carpeta del proyecto.",
    };
  }
}

async function handleRefreshDiagnostics() {
  if (isLoadingDiagnostics.value) return;
  isLoadingDiagnostics.value = true;
  try {
    bridgeDiagnostics.value = await openCodeBridge.fetchBridgeDiagnostics();
  } finally {
    isLoadingDiagnostics.value = false;
  }
}

function formatDiagTime(ts) {
  if (!ts) return "Sin registro";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

async function handleRetryFailedPrompt(entry) {
  const payload = entry?.retryPayload;
  if (!payload?.text || isSendingPrompt.value) return;
  retryingEntryId.value = entry.id || "retry";
  isSendingPrompt.value = true;
  commandFeedback.value = null;
  const targetAgent = payload.agentId || commandForm.agent || "architect";
  const targetSid = payload.sessionId || activeLogSessionId.value || null;
  try {
    const res = await openCodeBridge.sendPrompt({
      sessionId: targetSid,
      agent: targetAgent,
      text: payload.text,
      useActiveFallback: false,
    });
    if (res.ok) {
      if (res.sessionId) commandForm.sessionId = res.sessionId;
      nextTick(() => scrollLogToBottom(true));
    } else {
      commandFeedback.value = {
        ok: false,
        text: res.error || "No se pudo reintentar la instrucción",
      };
    }
  } finally {
    isSendingPrompt.value = false;
    retryingEntryId.value = null;
  }
}

function handleSaveTeamAndAliases() {
  for (const ag of profiles.value) {
    const draft = profileDrafts[ag.id];
    if (draft) {
      agentProfileManager.updateProfile(ag.id, {
        name: draft.name,
        role: draft.role,
        color: draft.color,
      });
    }
  }
  handleSaveAliases();
}

function handleResetTeamAndAliases() {
  agentProfileManager.resetProfiles();
  profiles.value = agentProfileManager.getProfiles();
  syncProfileDrafts(profiles.value);
  handleResetAliases();
}

function handleKeyDown(e) {
  if (e.key === "Escape") {
    if (isInspectorOpen.value) {
      isInspectorOpen.value = false;
      return;
    }
    if (isWhiteboardOpen.value) {
      isWhiteboardOpen.value = false;
      return;
    }
    if (isStandupOpen.value) {
      isStandupOpen.value = false;
      return;
    }
    if (isSettingsModalOpen.value) {
      isSettingsModalOpen.value = false;
      return;
    }
    if (isChatOpen.value) {
      isChatOpen.value = false;
      return;
    }
    if (selectedAgentId.value) {
      experience?.handleStationSelect(null);
      return;
    }
  }

  const tag = e.target?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (anyFloatingModalOpen.value) return;

  if (e.key === "Tab") {
    e.preventDefault();
    toggleChatPanel();
  } else if (e.key === "h" || e.key === "H") {
    toggleChatPanel();
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
  ambientAudio.init();
  audioMode.value = ambientAudio.getMode();
  unsubAudioChange = ambientAudio.onChange((st) => {
    audioMode.value = st.mode;
  });

  unsubProfileSync = officeEventBus.on(
    OFFICE_EVENTS.AGENT_PROFILE_UPDATED,
    () => {
      profiles.value = agentProfileManager.getProfiles();
      syncProfileDrafts(profiles.value);
    },
  );
  unsubTaskSync = officeEventBus.on(OFFICE_EVENTS.TASK_BOARD_SYNC, () => {
    tasks.value = taskBoardManager.getTasks();
  });
  unsubToolActivity = officeEventBus.on(
    OFFICE_EVENTS.OPENCODE_TOOL_ACTIVITY,
    () => {
      toolActivityList.value = openCodeBridge.getToolActivity("all");
    },
  );
  unsubWorkspace = officeEventBus.on(
    OFFICE_EVENTS.OFFICE_WORKSPACE_UPDATED,
    (payload) => {
      if (payload && typeof payload === "object") {
        workspaceSummary.value = payload;
        if (payload.projectDir && !workspaceDirInput.value) {
          workspaceDirInput.value = payload.projectDir;
        }
      }
    },
  );
  unsubWhiteboard = officeEventBus.on(
    OFFICE_EVENTS.OFFICE_WHITEBOARD_UPDATED,
    (payload) => {
      if (Array.isArray(payload?.notes)) {
        whiteboardNotes.value = payload.notes;
      } else if (payload?.note) {
        const filtered = whiteboardNotes.value.filter(
          (n) => n.id !== payload.note.id,
        );
        whiteboardNotes.value = [payload.note, ...filtered].slice(0, 12);
      }
    },
  );
  unsubOpenCode = officeEventBus.on(OFFICE_EVENTS.OPENCODE_CONNECTION, (snap) => {
    openCodeState.value = snap;

    const availableIds = new Set((snap.sessions || []).map((s) => s.id));
    if (commandForm.sessionId && !availableIds.has(commandForm.sessionId)) {
      commandForm.sessionId = "";
    }

    if (!commandForm.sessionId) {
      const preferredSid = snap.agentThreads?.[commandForm.agent]?.sessionId;
      if (preferredSid && availableIds.has(preferredSid)) {
        commandForm.sessionId = preferredSid;
      }
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
          openCodeState.value.childSessionsByParent?.[
            activeLogSessionId.value
          ] || [];
        const isTrackedChild =
          Object.prototype.hasOwnProperty.call(
            childSessionLogs,
            payload.sessionId,
          ) ||
          parentChildren.includes(payload.sessionId) ||
          sessionLogEntries.value.some(
            (e) => e.childSessionId === payload.sessionId,
          );
        if (isTrackedChild) {
          childSessionLogs[payload.sessionId] = entries;
        }
      }
      if (
        !payload?.sessionId ||
        payload.sessionId === activeLogSessionId.value
      ) {
        const el = logContainerRef.value;
        const shouldAutoScroll =
          !el || el.scrollHeight - el.scrollTop - el.clientHeight < 56;
        sessionLogEntries.value = entries;
        syncChildLogsForEntries(entries);
        if (shouldAutoScroll) {
          nextTick(() => scrollLogToBottom(true));
        }
      }
    },
  );
  syncSessionLogView();

  // Autoconexión al iniciar si el usuario la activó en Ajustes
  if (openCodeForm.autoConnect && openCodeState.value.status === "disconnected") {
    openCodeBridge.connect();
  } else {
    // Cargar pizarra y estado Git si el puente local ya está corriendo
    openCodeBridge.fetchWhiteboard();
    openCodeBridge.fetchWorkspaceSummary().then((res) => {
      if (res?.ok && res.projectDir) {
        workspaceDirInput.value = res.projectDir;
      }
    });
  }

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
        },
        onPropSelect: (propHit) => {
          handlePropSelected(propHit);
        },
        onHoverTarget: (hoverInfo) => {
          hoveredProp.value = hoverInfo;
        },
        onAgentUpdate: (agentId, snapshot) => {
          agentSnapshots[agentId] = snapshot;
        },
        onCameraViewChanged: (isOverview) => {
          isOverviewCamera.value = Boolean(isOverview);
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

function selectChatAgent(
  agentId,
  { focus3d = false, openDrawer = false } = {},
) {
  const targetAgent = agentId || "architect";
  questionError.value = null;
  replyingQuestionId.value = null;
  commandFeedback.value = null;
  commandForm.agent = targetAgent;

  const preferredSid =
    openCodeBridge.getPreferredSessionForAgent(targetAgent) || "";
  commandForm.sessionId = preferredSid;

  if (targetAgent === "architect" && preferredSid) {
    openCodeBridge.setActiveSession(preferredSid);
  }

  const willBeOpen = openDrawer || isChatOpen.value;
  openCodeBridge.setViewedThread({
    agentId: targetAgent,
    sessionId: preferredSid || null,
    chatOpen: willBeOpen,
  });

  if (preferredSid && openCodeState.value.status === "connected") {
    openCodeBridge.hydrateSessionHistory(preferredSid);
    openCodeBridge.syncPendingQuestions(preferredSid);
  }

  if (openDrawer) {
    isChatOpen.value = true;
    nextTick(() => scrollLogToBottom(true));
  }

  if (focus3d && experience) {
    experience.handleStationSelect(targetAgent, { focusCamera: true });
  }
}

function selectAgentFromDock(agentId) {
  if (!experience) return;
  if (hasAgentAttention(agentId)) {
    selectChatAgent(agentId, { focus3d: true, openDrawer: true });
    return;
  }
  if (selectedAgentId.value === agentId) {
    experience.focusAgent(agentId);
  } else {
    experience.handleStationSelect(agentId, { focusCamera: true });
  }
}

function handleResetOverview() {
  experience?.handleStationSelect(null);
  experience?.resetCamera();
}

function toggleChatPanel() {
  isChatOpen.value = !isChatOpen.value;
  if (isChatOpen.value) {
    nextTick(() => scrollLogToBottom(true));
  }
}

function handleDismissInquiry(inquiry) {
  if (!inquiry?.id) return;
  openCodeBridge.dismissInquiry(inquiry.id);
}

function openSettingsModal(tab = "connection") {
  settingsTab.value = tab;
  isSettingsModalOpen.value = true;
  if (tab === "connection") {
    handleRefreshDiagnostics();
  }
}

function dismissBlockedAlert(task) {
  if (!task) return;
  const next = new Set(dismissedBlockedAlertKeys.value);
  next.add(`${task.id}:${task.updatedAt}`);
  dismissedBlockedAlertKeys.value = next;
}

function downloadTextFile(
  filename,
  content,
  mimeType = "text/plain;charset=utf-8",
) {
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
  downloadTextFile(
    "opencode.json",
    OPENCODE_JSON_SNIPPET,
    "application/json;charset=utf-8",
  );
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
    autoConnect: Boolean(openCodeForm.autoConnect),
  });
}

async function handleToggleOpenCodeConnection() {
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
  saveOpenCodeConfig();
  isTestingConnection.value = true;
  testResult.value = null;
  testResult.value = await openCodeBridge.testConnection();
  isTestingConnection.value = false;
}

function handleSaveAliases() {
  openCodeBridge.updateConfig({ aliases: { ...aliasDraft } });
}

function handleResetAliases() {
  const cfg = openCodeBridge.resetAliases();
  syncAliasDraft(cfg);
}

async function copySnippet(key, text) {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
    copyFeedbackTimer = setTimeout(() => {
      copiedKey.value = null;
    }, 1800);
  } catch {
    copiedKey.value = null;
  }
}

async function handleCreateOpenCodeSession() {
  if (isCreatingSession.value) return;
  isCreatingSession.value = true;
  commandFeedback.value = null;
  questionError.value = null;
  replyingQuestionId.value = null;
  try {
    const targetAgent = commandForm.agent || "architect";
    const session = await openCodeBridge.createSession({
      agent: targetAgent,
      purgeOthers: false,
    });
    if (session?.id) {
      commandForm.sessionId = session.id;
      if (targetAgent === "architect") {
        openCodeBridge.setActiveSession(session.id);
      }
      openCodeBridge.setViewedThread({
        agentId: targetAgent,
        sessionId: session.id,
        chatOpen: isChatOpen.value,
      });
    }
  } catch (err) {
    commandFeedback.value = {
      ok: false,
      text: err?.message || "No se pudo iniciar una nueva conversación",
    };
  } finally {
    isCreatingSession.value = false;
  }
}

function handleComposerKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSendOpenCodePrompt();
  }
}

async function handleSendOpenCodePrompt() {
  if (isSendingPrompt.value || !commandForm.prompt.trim()) return;
  isSendingPrompt.value = true;
  commandFeedback.value = null;
  const targetAgent = commandForm.agent || "architect";
  const targetSid = activeLogSessionId.value || null;
  const res = await openCodeBridge.sendPrompt({
    sessionId: targetSid,
    agent: targetAgent,
    text: commandForm.prompt,
    useActiveFallback: false,
  });
  isSendingPrompt.value = false;

  if (res.ok) {
    if (res.sessionId) commandForm.sessionId = res.sessionId;
    commandForm.prompt = "";
    nextTick(() => scrollLogToBottom(true));
  } else {
    commandFeedback.value = {
      ok: false,
      text: res.error || "No se pudo enviar el mensaje",
    };
  }
}

async function handleInterruptOpenCode() {
  if (isInterrupting.value) return;
  isInterrupting.value = true;
  commandFeedback.value = null;
  questionError.value = null;
  replyingQuestionId.value = null;
  const res = await openCodeBridge.interruptSession(
    activeLogSessionId.value || openCodeState.value.activeSessionId,
  );
  isInterrupting.value = false;
  if (!res.ok) {
    commandFeedback.value = {
      ok: false,
      text: res.error || "No se pudo detener la respuesta",
    };
  }
}

function handleToggleChildThread(childSessionId, event) {
  if (!childSessionId || !event?.target?.open) return;
  childSessionLogs[childSessionId] =
    openCodeBridge.getSessionLog(childSessionId);
  openCodeBridge.hydrateSessionHistory(childSessionId);
}

function getVisibleChildEntries(childSessionId) {
  if (!childSessionId) return [];
  const raw =
    childSessionLogs[childSessionId] ||
    openCodeBridge.getSessionLog(childSessionId);
  return raw.filter(
    (entry) =>
      (entry.kind === "text" && entry.content) || entry.kind === "error",
  );
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
  } else {
    questionError.value = res.error || "No se pudo enviar la respuesta";
  }
}

function handleDismissQuestion(item) {
  if (!item?.id) return;
  openCodeBridge.dismissQuestion(item.id);
  delete questionDrafts[item.id];
  questionError.value = null;
  if (replyingQuestionId.value === item.id) {
    replyingQuestionId.value = null;
  }
}

async function handleRejectQuestion(item) {
  if (!item?.id || replyingQuestionId.value) return;
  replyingQuestionId.value = item.id;
  questionError.value = null;
  const res = await openCodeBridge.replyQuestion(item.id, [], { reject: true });
  replyingQuestionId.value = null;
  if (!res.ok) {
    openCodeBridge.dismissQuestion(item.id);
  }
  delete questionDrafts[item.id];
}

async function handleReplyPermission(requestId, response) {
  if (replyingPermissionId.value) return;
  replyingPermissionId.value = requestId;
  permissionError.value = null;
  const res = await openCodeBridge.replyPermission(requestId, response);
  replyingPermissionId.value = null;
  if (!res.ok) {
    permissionError.value = res.error || "No se pudo responder el permiso";
  }
}

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyDown);
  unsubProfileSync?.();
  unsubTaskSync?.();
  unsubOpenCode?.();
  unsubSessionLog?.();
  unsubToolActivity?.();
  unsubWorkspace?.();
  unsubWhiteboard?.();
  unsubAudioChange?.();
  ambientAudio.dispose();
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
  openCodeBridge.dispose();
  experience?.destroy();
});
</script>

<template>
  <main
    class="w-full h-screen relative bg-[#161412] overflow-hidden font-sans select-none text-[#F3EFE8]"
  >
    <!-- Canvas WebGL 3D a pantalla completa -->
    <div class="w-full h-full relative">
      <canvas ref="canvasRef" class="w-full h-full block outline-none" />
    </div>

    <!-- Pantalla de carga inicial -->
    <div
      v-if="!isReady"
      class="absolute inset-0 bg-[#161412] flex flex-col items-center justify-center p-6 z-50"
    >
      <div class="w-72 space-y-3">
        <div class="flex items-center justify-between text-xs text-[#B5AEA4]">
          <span class="font-medium text-[#F3EFE8]">Preparando el estudio</span>
          <span class="tabular-nums">{{ loadProgress }}%</span>
        </div>
        <div class="w-full h-1 bg-[#282420] rounded-full overflow-hidden">
          <div
            class="h-full bg-[#E09F5A] transition-transform duration-150 ease-out origin-left"
            :style="{ transform: `scaleX(${loadProgress / 100})` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- ZONA 1: Acceso discreto Vista General (visible solo al orbitar o seguir a alguien) -->
    <transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1.5"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-120 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-1.5"
    >
      <div
        v-if="isReady && !isOverviewCamera"
        class="absolute top-4 left-4 z-20 pointer-events-auto"
      >
        <button
          type="button"
          @click="handleResetOverview"
          class="hud-glass px-3 py-1.5 rounded-xl text-xs font-medium text-[#E7E1D8] hover:text-[#FFFDF9] flex items-center gap-1.5 transition-opacity duration-150 cursor-pointer whitespace-nowrap hover:opacity-95"
        >
          <RotateCcw class="w-3.5 h-3.5 text-[#E09F5A]" />
          <span>Vista General</span>
        </button>
      </div>
    </transition>

    <!-- ZONA 2: Esquina Superior Derecha (Estado discreto + Chat + Avisos) -->
    <div
      v-if="isReady"
      class="absolute top-4 right-4 z-30 flex flex-col items-end gap-2.5 pointer-events-none"
    >
      <div class="flex items-center gap-2 pointer-events-auto">
        <!-- Botón discreto de Audio (Solo avisos / Ambiente / Silencio) -->
        <button
          type="button"
          @click="handleCycleAudioMode"
          :title="audioModeLabel"
          :aria-label="audioModeLabel"
          class="hud-glass p-2 rounded-xl text-xs font-medium text-[#DCD5CC] hover:text-[#FFFDF9] flex items-center justify-center transition-transform duration-150 active:scale-95 cursor-pointer"
        >
          <Volume2 v-if="audioMode === 'ambient'" class="w-3.5 h-3.5 text-[#E09F5A]" />
          <VolumeX v-else-if="audioMode === 'muted'" class="w-3.5 h-3.5 text-[#8C847A]" />
          <Volume1 v-else class="w-3.5 h-3.5 text-[#C8C0B5]" />
        </button>

        <!-- Botón discreto de Estado de Conexión y Ajustes -->
        <button
          type="button"
          @click="openSettingsModal('connection')"
          title="Conexión y ajustes"
          aria-label="Conexión y ajustes"
          class="hud-glass px-2.5 py-2 rounded-xl text-xs font-medium text-[#DCD5CC] hover:text-[#FFFDF9] flex items-center gap-2 transition-transform duration-150 active:scale-95 cursor-pointer"
        >
          <span
            :class="[
              'w-2 h-2 rounded-full shrink-0',
              openCodeState.status === 'connected'
                ? 'bg-[#34D399]'
                : openCodeState.status === 'connecting'
                  ? 'bg-[#F59E0B]'
                  : openCodeState.status === 'error'
                    ? 'bg-[#FB7185]'
                    : 'bg-[#78716C]',
            ]"
          ></span>
          <SlidersHorizontal class="w-3.5 h-3.5 text-[#C8C0B5]" />
        </button>

        <!-- Botón discreto para abrir/ocultar Chat -->
        <button
          type="button"
          @click="toggleChatPanel"
          title="Abrir o cerrar chat (Tab / H)"
          :class="[
            'hud-glass px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-transform duration-150 active:scale-95 cursor-pointer whitespace-nowrap',
            isChatOpen
              ? 'text-[#FFFDF9] ring-1 ring-[#E09F5A]/45'
              : 'text-[#EAE4DC] hover:text-[#FFFDF9]',
          ]"
        >
          <MessageSquare class="w-3.5 h-3.5 text-[#E09F5A]" />
          <span>Chat</span>
          <span
            v-if="pendingAttentionCount > 0"
            class="px-1.5 py-0.5 rounded-md bg-[#E09F5A] text-[10px] font-semibold text-[#1B1714] tabular-nums leading-none"
          >
            {{ pendingAttentionCount }}
          </span>
        </button>
      </div>

      <!-- Notificaciones flotantes cálidas cuando el chat está cerrado o hay permisos -->
      <div
        v-if="
          activePermission ||
          (!isChatOpen && (toastQuestion || toastInquiry)) ||
          blockedCliAlerts.length > 0
        "
        class="w-[min(368px,92vw)] flex flex-col gap-2 pointer-events-auto"
      >
        <!-- Toast compacto (máx. 2 líneas) de pregunta interactiva pendiente -->
        <div
          v-if="!isChatOpen && toastQuestion"
          class="hud-glass-elevated rounded-2xl px-3.5 py-2.5 space-y-1.5"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#F6EFE6] min-w-0 truncate">
              <span
                class="w-2 h-2 rounded-full shrink-0"
                :style="{
                  backgroundColor:
                    profileMap[toastQuestion.agentId]?.color || '#E09F5A',
                }"
              ></span>
              <span class="truncate">
                {{
                  profileMap[toastQuestion.agentId]?.name || "Equipo"
                }} te hace una consulta
              </span>
            </div>
            <button
              type="button"
              @click="handleDismissQuestion(toastQuestion)"
              title="Descartar"
              aria-label="Descartar consulta"
              class="p-0.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.06] cursor-pointer shrink-0"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex items-center justify-between gap-2.5">
            <p class="text-xs text-[#C8C0B5] truncate flex-1 min-w-0">
              {{ toastQuestion.questions[0]?.question }}
            </p>
            <button
              type="button"
              @click="
                selectChatAgent(toastQuestion.agentId, {
                  focus3d: true,
                  openDrawer: true,
                })
              "
              class="px-2.5 py-1 rounded-lg bg-[#E09F5A] hover:bg-[#E7AF72] text-[11px] font-semibold text-[#1B1714] cursor-pointer whitespace-nowrap shrink-0"
            >
              Responder
            </button>
          </div>
        </div>

        <!-- Toast compacto (máx. 2 líneas) de consulta proactiva o escalado de revisión -->
        <div
          v-if="!isChatOpen && toastInquiry"
          :class="[
            'hud-glass-elevated rounded-2xl px-3.5 py-2.5 space-y-1.5',
            toastInquiry.isEscalation ? 'border border-[#FB7185]/45' : '',
          ]"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#F6EFE6] min-w-0 truncate">
              <AlertTriangle
                v-if="toastInquiry.isEscalation"
                class="w-3.5 h-3.5 text-[#FB7185] shrink-0"
              />
              <span
                v-else
                class="w-2 h-2 rounded-full shrink-0"
                :style="{
                  backgroundColor:
                    profileMap[toastInquiry.agentId]?.color || '#E09F5A',
                }"
              ></span>
              <span class="truncate">
                <template v-if="toastInquiry.isEscalation">
                  Revisión detenida ({{ toastInquiry.round || 2 }}/{{ toastInquiry.maxRounds || 2 }}) · Requiere tu decisión
                </template>
                <template v-else>
                  {{
                    profileMap[toastInquiry.agentId]?.name || toastInquiry.agentId
                  }} te hace una consulta
                </template>
              </span>
            </div>
            <button
              type="button"
              @click="handleDismissInquiry(toastInquiry)"
              title="Descartar"
              aria-label="Descartar consulta"
              class="p-0.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.06] cursor-pointer shrink-0"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div class="flex items-center justify-between gap-2.5">
            <p class="text-xs text-[#C8C0B5] truncate flex-1 min-w-0">
              {{ toastInquiry.excerpt }}
            </p>
            <button
              type="button"
              @click="
                selectChatAgent(toastInquiry.agentId, {
                  focus3d: true,
                  openDrawer: true,
                })
              "
              class="px-2.5 py-1 rounded-lg bg-[#E09F5A] hover:bg-[#E7AF72] text-[11px] font-semibold text-[#1B1714] cursor-pointer whitespace-nowrap shrink-0"
            >
              {{ toastInquiry.isEscalation ? "Revisar hilo" : "Responder" }}
            </button>
          </div>
        </div>

        <!-- Toast de permiso pendiente -->
        <div
          v-if="activePermission"
          class="hud-glass-elevated rounded-2xl p-3.5 space-y-2.5"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-semibold text-[#FCD34D]">
              <ShieldAlert class="w-4 h-4 text-[#F59E0B] shrink-0" />
              <span>Autorización solicitada</span>
            </div>
            <span class="text-[11px] text-[#B5AEA4]">
              {{
                profileMap[activePermission.agentId]?.name ||
                activePermission.agentId
              }}
            </span>
          </div>

          <div class="space-y-1">
            <div class="text-xs font-medium text-[#F3EFE8]">
              {{ activePermission.title }}
            </div>
            <div
              class="text-[11px] text-[#C8C0B5] bg-black/20 border border-white/[0.06] rounded-lg px-2.5 py-1.5 truncate tabular-nums"
            >
              {{ activePermission.targetSummary }}
            </div>
          </div>

          <div v-if="permissionError" class="text-[11px] text-[#FDA4AF]">
            {{ permissionError }}
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'once')"
              class="px-2.5 py-1.5 rounded-lg bg-[#34D399]/90 hover:bg-[#34D399] text-xs font-semibold text-[#111814] cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Permitir una vez
            </button>
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'always')"
              class="px-2.5 py-1.5 rounded-lg bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Permitir siempre
            </button>
            <button
              type="button"
              :disabled="replyingPermissionId === activePermission.id"
              @click="handleReplyPermission(activePermission.id, 'reject')"
              class="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-xs font-medium text-[#FCA5A5] cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        </div>

        <!-- Alertas de espera -->
        <div
          v-for="alert in blockedCliAlerts"
          :key="alert.id"
          class="hud-glass-elevated rounded-2xl p-3 space-y-2"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2 text-xs font-medium text-[#FCA5A5]">
              <AlertTriangle class="w-4 h-4 text-[#FB7185] shrink-0" />
              <span>{{ alert.title }}</span>
            </div>
            <button
              type="button"
              @click="dismissBlockedAlert(alert)"
              aria-label="Cerrar aviso"
              class="p-0.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] cursor-pointer"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
          <div class="flex items-center justify-between gap-2 text-[11px] text-[#B5AEA4]">
            <span class="truncate">
              {{ profileMap[alert.assigneeId]?.name || alert.assigneeId }}
            </span>
            <button
              type="button"
              @click="
                selectChatAgent(alert.assigneeId || 'architect', {
                  focus3d: true,
                  openDrawer: true,
                })
              "
              class="px-2.5 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-[11px] font-medium text-[#F3EFE8] cursor-pointer whitespace-nowrap shrink-0"
            >
              Abrir chat
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ZONA 3: Dock Inferior Minimalista + Tarjeta Humana del Agente -->
    <section
      v-if="isReady"
      class="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center w-auto max-w-[94vw] pointer-events-none"
    >
      <!-- Tarjeta compacta del agente seleccionado -->
      <transition
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-120 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-2"
      >
        <div
          v-if="selectedSnapshot"
          class="pointer-events-auto mb-3 w-[min(340px,92vw)] hud-glass-elevated rounded-2xl p-4 space-y-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <span
                class="w-3 h-3 rounded-full shrink-0"
                :style="{ backgroundColor: selectedSnapshot.color }"
              ></span>
              <div class="min-w-0">
                <div class="text-sm font-semibold text-[#F6EFE6] truncate">
                  {{ selectedSnapshot.name }}
                </div>
                <div class="text-xs text-[#B5AEA4] truncate">
                  {{ selectedSnapshot.role }}
                </div>
              </div>
            </div>

            <button
              type="button"
              @click="experience?.handleStationSelect(null)"
              aria-label="Cerrar tarjeta"
              class="p-1 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer shrink-0"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <div class="space-y-1.5 pt-1 border-t border-white/[0.08]">
            <div class="flex items-center gap-2 text-xs text-[#F3EFE8]">
              <span
                :class="[
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  openCodeState.activeAgents.includes(selectedSnapshot.id)
                    ? 'bg-[#34D399]'
                    : 'bg-[#E09F5A]',
                ]"
              ></span>
              <span class="font-medium">{{ selectedHumanState }}</span>
            </div>
            <p class="text-xs text-[#C8C0B5] leading-relaxed line-clamp-2">
              {{ selectedHumanTaskSummary }}
            </p>
          </div>

          <div class="pt-0.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              @click="experience?.focusAgent(selectedSnapshot.id)"
              class="px-3 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.13] border border-white/[0.08] text-xs font-medium text-[#F6EFE6] flex items-center justify-center gap-1.5 transition-transform duration-150 active:scale-[0.99] cursor-pointer whitespace-nowrap"
            >
              <Crosshair class="w-3.5 h-3.5 text-[#E09F5A]" />
              <span>Seguir</span>
            </button>
            <button
              type="button"
              @click="openInspectorModal({ tab: 'activity', agentId: selectedSnapshot.id })"
              class="px-3 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.08] text-xs font-medium text-[#DDD6CD] hover:text-[#FFFDF9] flex items-center justify-center gap-1.5 transition-transform duration-150 active:scale-[0.99] cursor-pointer whitespace-nowrap"
            >
              <GitBranch class="w-3.5 h-3.5 text-[#E09F5A]" />
              <span>Ver cambios</span>
            </button>
          </div>
        </div>
      </transition>

      <!-- Dock Minimalista: Únicamente los 5 avatares del equipo -->
      <nav
        aria-label="Equipo de la oficina"
        class="pointer-events-auto hud-glass rounded-2xl px-2.5 py-2 flex flex-wrap items-center justify-center gap-1.5"
      >
        <button
          v-for="agent in agentList"
          :key="agent.id"
          type="button"
          @click="selectAgentFromDock(agent.id)"
          :style="getAgentChipStyle(agent)"
          :title="
            hasAgentAttention(agent.id)
              ? `${agent.name} tiene una consulta pendiente`
              : agent.name
          "
          :class="[
            'px-3 py-1.5 rounded-xl text-xs font-medium transition-transform duration-150 active:scale-95 cursor-pointer flex items-center gap-2 whitespace-nowrap border',
            selectedAgentId === agent.id
              ? 'text-[#FFFDF9]'
              : hasAgentAttention(agent.id)
                ? 'bg-[#F59E0B]/[0.09] border-[#F59E0B]/40 text-[#FFFDF9] hover:bg-[#F59E0B]/[0.15]'
                : 'bg-white/[0.04] border-white/[0.07] text-[#DDD6CD] hover:bg-white/[0.09] hover:text-[#FFFDF9]',
          ]"
        >
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: agent.color }"
          ></span>
          <span>{{ agent.name }}</span>
          <span
            v-if="hasAgentAttention(agent.id)"
            class="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse shrink-0"
            title="Consulta pendiente"
          ></span>
          <span
            v-else-if="
              getAgentThreadInfo(agent.id).isBusy ||
              openCodeState.activeAgents.includes(agent.id)
            "
            class="w-1.5 h-1.5 rounded-full bg-[#34D399] shrink-0"
            title="Trabajando ahora"
          ></span>
        </button>
      </nav>
    </section>

    <!-- ZONA 4A: Panel Lateral Derecho de Chat Conversacional (Oculto por defecto) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-x-6"
      enter-to-class="opacity-100 translate-x-0"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100 translate-x-0"
      leave-to-class="opacity-0 translate-x-6"
    >
      <aside
        v-if="isReady && isChatOpen"
        class="fixed top-4 right-4 bottom-4 w-[min(420px,calc(100vw-2rem))] z-40 hud-glass-elevated rounded-2xl flex flex-col overflow-hidden pointer-events-auto"
      >
        <!-- Cabecera limpia del chat -->
        <div
          class="px-4 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <MessageSquare class="w-4 h-4 text-[#E09F5A] shrink-0" />
            <span class="text-sm font-semibold text-[#F6EFE6]">Equipo</span>
            <button
              v-if="openCodeState.status !== 'connected'"
              type="button"
              @click="openSettingsModal('connection')"
              class="text-[11px] text-[#C8C0B5] hover:text-[#FFFDF9] underline decoration-white/20 underline-offset-2 cursor-pointer truncate"
            >
              Conectar servidor
            </button>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              @click="openInspectorModal({ tab: 'git', agentId: commandForm.agent })"
              title="Ver cambios Git y actividad técnica"
              class="px-2 py-1 rounded-lg text-[11px] font-medium text-[#C8C0B5] hover:text-[#FFFDF9] hover:bg-white/[0.07] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <GitBranch class="w-3.5 h-3.5 text-[#E09F5A]" />
              <span v-if="workspaceChangedCount > 0" class="tabular-nums">
                {{ workspaceChangedCount }}
              </span>
            </button>
            <button
              type="button"
              @click="isChatOpen = false"
              title="Ocultar chat (Tab / H)"
              aria-label="Cerrar chat"
              class="p-1.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Selector unificado por miembro del equipo -->
        <div
          v-if="
            openCodeState.status === 'connected' ||
            openCodeState.sessions.length > 0
          "
          class="px-4 py-2.5 border-b border-white/[0.07] flex items-center gap-2 shrink-0"
        >
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :style="{
              backgroundColor:
                profileMap[commandForm.agent]?.color || '#E09F5A',
            }"
          ></span>
          <select
            v-model="commandForm.agent"
            @change="selectChatAgent(commandForm.agent)"
            aria-label="Miembro del equipo"
            class="flex-1 min-w-0 px-2.5 py-1.5 rounded-xl bg-black/25 border border-white/[0.08] text-xs font-medium text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60"
          >
            <option v-for="ag in agentList" :key="ag.id" :value="ag.id">
              {{ formatMemberOptionLabel(ag) }}
            </option>
          </select>
          <button
            type="button"
            :disabled="isCreatingSession || openCodeState.status !== 'connected'"
            @click="handleCreateOpenCodeSession"
            title="Iniciar nueva conversación con este miembro"
            class="px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-xs font-medium text-[#F3EFE8] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
          >
            <Plus class="w-3.5 h-3.5" />
            <span>{{ isCreatingSession ? "Creando..." : "Nueva" }}</span>
          </button>
        </div>

        <!-- Aviso discreto cuando otro miembro hace una consulta o se escala una revisión -->
        <div
          v-if="toastQuestion || toastInquiry"
          :class="[
            'px-4 py-2 border-b flex items-center justify-between gap-2 shrink-0',
            !toastQuestion && toastInquiry?.isEscalation
              ? 'border-[#FB7185]/35 bg-[#FB7185]/[0.1]'
              : 'border-[#F59E0B]/25 bg-[#F59E0B]/[0.08]',
          ]"
        >
          <div class="flex items-center gap-2 min-w-0 text-xs text-[#F6EFE6]">
            <AlertTriangle
              v-if="!toastQuestion && toastInquiry?.isEscalation"
              class="w-3.5 h-3.5 text-[#FB7185] shrink-0"
            />
            <span
              v-else
              class="w-2 h-2 rounded-full shrink-0"
              :style="{
                backgroundColor:
                  profileMap[(toastQuestion || toastInquiry).agentId]?.color ||
                  '#F59E0B',
              }"
            ></span>
            <span class="truncate">
              <template v-if="!toastQuestion && toastInquiry?.isEscalation">
                Límite de revisión ({{ toastInquiry.round || 2 }}/{{ toastInquiry.maxRounds || 2 }}) · Requiere tu decisión
              </template>
              <template v-else>
                {{
                  profileMap[(toastQuestion || toastInquiry).agentId]?.name ||
                  (toastQuestion || toastInquiry).agentId
                }} te hace una consulta
              </template>
            </span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              @click="
                selectChatAgent((toastQuestion || toastInquiry).agentId, {
                  focus3d: true,
                  openDrawer: true,
                })
              "
              class="px-2.5 py-1 rounded-lg bg-[#E09F5A] hover:bg-[#E7AF72] text-[11px] font-semibold text-[#1B1714] cursor-pointer whitespace-nowrap"
            >
              {{ !toastQuestion && toastInquiry?.isEscalation ? "Revisar" : "Responder" }}
            </button>
            <button
              type="button"
              @click="
                toastQuestion
                  ? handleDismissQuestion(toastQuestion)
                  : handleDismissInquiry(toastInquiry)
              "
              aria-label="Descartar consulta"
              class="p-0.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] cursor-pointer"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Pregunta interactiva en línea dentro del hilo actual -->
        <div
          v-if="currentThreadQuestion"
          class="px-4 py-3 border-b border-[#E09F5A]/30 bg-[#E09F5A]/[0.07] space-y-2.5 shrink-0 max-h-[40vh] overflow-y-auto"
        >
          <div class="flex items-center justify-between gap-2 text-xs">
            <span class="font-semibold text-[#F6EFE6] flex items-center gap-1.5">
              <span
                class="w-2 h-2 rounded-full shrink-0"
                :style="{
                  backgroundColor:
                    profileMap[currentThreadQuestion.agentId]?.color || '#E09F5A',
                }"
              ></span>
              <span>
                {{
                  profileMap[currentThreadQuestion.agentId]?.name ||
                  "Consulta del equipo"
                }}
              </span>
            </span>
            <button
              type="button"
              @click="handleDismissQuestion(currentThreadQuestion)"
              title="Descartar"
              aria-label="Descartar pregunta"
              class="p-1 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>

          <div
            v-for="(q, qIdx) in currentThreadQuestion.questions"
            :key="`${currentThreadQuestion.id}_${qIdx}`"
            class="space-y-1.5"
          >
            <div class="text-xs text-[#F3EFE8] leading-relaxed select-text">
              {{ q.question }}
            </div>

            <div v-if="q.options.length > 0" class="flex flex-col gap-1 pt-0.5">
              <button
                v-for="(opt, optIdx) in q.options"
                :key="`${opt.label}_${optIdx}`"
                type="button"
                :disabled="replyingQuestionId === currentThreadQuestion.id"
                @click="
                  toggleQuestionOption(currentThreadQuestion, qIdx, opt.label)
                "
                :class="[
                  'w-full text-left px-2.5 py-1.5 rounded-xl border text-xs cursor-pointer flex items-start justify-between gap-2 disabled:opacity-50',
                  isOptionSelected(currentThreadQuestion, qIdx, opt.label)
                    ? 'bg-[#E09F5A]/20 border-[#E09F5A]/55 text-[#FFFDF9]'
                    : 'bg-black/25 border-white/[0.08] text-[#DDD6CD] hover:bg-white/[0.06]',
                ]"
              >
                <span class="min-w-0">
                  <span class="font-medium block">{{ opt.label }}</span>
                  <span
                    v-if="opt.description"
                    class="text-[11px] text-[#B5AEA4] block leading-snug"
                  >
                    {{ opt.description }}
                  </span>
                </span>
                <Check
                  v-if="isOptionSelected(currentThreadQuestion, qIdx, opt.label)"
                  class="w-3.5 h-3.5 text-[#E09F5A] shrink-0 mt-0.5"
                />
              </button>
            </div>

            <input
              v-if="q.custom !== false"
              :value="getQuestionCustomText(currentThreadQuestion, qIdx)"
              @input="
                setQuestionCustomText(
                  currentThreadQuestion,
                  qIdx,
                  $event.target.value,
                )
              "
              type="text"
              @keydown.enter.prevent="
                canSubmitQuestion(currentThreadQuestion) &&
                handleSubmitQuestion(currentThreadQuestion)
              "
              :placeholder="
                q.options.length > 0
                  ? 'O escribe otra respuesta...'
                  : 'Escribe tu respuesta...'
              "
              class="w-full px-2.5 py-1.5 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] placeholder:text-[#8C847A] focus:outline-none focus:border-[#E09F5A]/60"
            />
          </div>

          <div v-if="questionError" class="text-[11px] text-[#FDA4AF]">
            {{ questionError }}
          </div>

          <div class="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              :disabled="replyingQuestionId === currentThreadQuestion.id"
              @click="handleRejectQuestion(currentThreadQuestion)"
              class="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] text-[11px] font-medium text-[#C8C0B5] cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              Omitir
            </button>
            <button
              type="button"
              :disabled="
                replyingQuestionId === currentThreadQuestion.id ||
                !canSubmitQuestion(currentThreadQuestion)
              "
              @click="handleSubmitQuestion(currentThreadQuestion)"
              class="px-3 py-1.5 rounded-lg bg-[#E09F5A] hover:bg-[#E7AF72] text-[11px] font-semibold text-[#1B1714] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-45"
            >
              <Send class="w-3 h-3" />
              <span>{{
                replyingQuestionId === currentThreadQuestion.id
                  ? "Enviando..."
                  : "Enviar respuesta"
              }}</span>
            </button>
          </div>
        </div>

        <!-- Stream limpio de mensajes humanos -->
        <div
          ref="logContainerRef"
          class="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
        >
          <!-- Estado inicial sin conexión -->
          <div
            v-if="
              openCodeState.status !== 'connected' &&
              visibleChatEntries.length === 0
            "
            class="h-full flex flex-col items-center justify-center text-center px-4 py-8 space-y-3"
          >
            <p class="text-xs text-[#C8C0B5] leading-relaxed max-w-[260px]">
              Conecta tu entorno local para conversar directamente con los miembros
              de la oficina.
            </p>
            <button
              type="button"
              @click="openSettingsModal('connection')"
              class="px-3.5 py-2 rounded-xl bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] cursor-pointer"
            >
              Configurar conexión
            </button>
          </div>

          <!-- Esqueleto suave mientras carga el historial -->
          <div
            v-else-if="
              activeHistoryState.status === 'loading' &&
              visibleChatEntries.length === 0
            "
            class="space-y-2.5 py-2"
          >
            <div class="h-10 rounded-xl bg-white/[0.05] animate-pulse w-3/4 ml-auto"></div>
            <div class="h-16 rounded-xl bg-white/[0.05] animate-pulse w-5/6"></div>
          </div>

          <!-- Conversación vacía conectada -->
          <div
            v-else-if="visibleChatEntries.length === 0"
            class="h-full flex items-center justify-center text-center px-4 py-8"
          >
            <p class="text-xs text-[#A39B90] leading-relaxed max-w-[260px]">
              Escribe un mensaje abajo para hablar directamente con
              {{ profileMap[commandForm.agent]?.name || "este miembro" }}.
            </p>
          </div>

          <template v-for="entry in visibleChatEntries" :key="entry.id">
            <!-- Mensaje del usuario -->
            <div
              v-if="entry.kind === 'prompt'"
              class="ml-8 rounded-2xl rounded-tr-sm bg-[#E09F5A]/18 border border-[#E09F5A]/30 px-3.5 py-2.5 space-y-1"
            >
              <div class="flex items-center justify-between gap-2 text-[11px]">
                <span class="font-semibold text-[#F6C894]">Tú</span>
                <span class="text-[#C8C0B5]">
                  para {{ profileMap[entry.agentId]?.name || entry.agentId }}
                </span>
              </div>
              <div
                class="text-xs text-[#F8F4EE] whitespace-pre-wrap select-text leading-relaxed"
              >
                {{ entry.content }}
              </div>
            </div>

            <!-- Registro de auditoría: Revisión automática entre especialistas -->
            <div
              v-else-if="entry.kind === 'peer_review'"
              :class="[
                'rounded-xl border px-3.5 py-2.5 space-y-1.5',
                entry.reviewMeta?.escalated
                  ? 'bg-[#FB7185]/[0.1] border-[#FB7185]/35'
                  : 'bg-[#8B5CF6]/[0.09] border-[#8B5CF6]/30',
              ]"
            >
              <div class="flex items-center justify-between gap-2 text-[11px]">
                <span
                  :class="[
                    'font-semibold flex items-center gap-1.5 min-w-0 truncate',
                    entry.reviewMeta?.escalated ? 'text-[#FECDD3]' : 'text-[#DDD6FE]',
                  ]"
                >
                  <AlertTriangle
                    v-if="entry.reviewMeta?.escalated"
                    class="w-3.5 h-3.5 text-[#FB7185] shrink-0"
                  />
                  <span
                    v-else
                    class="w-2 h-2 rounded-full shrink-0"
                    :style="{
                      backgroundColor:
                        profileMap[entry.reviewMeta?.fromAgentId || entry.agentId]?.color ||
                        '#8B5CF6',
                    }"
                  ></span>
                  <span class="truncate">
                    {{ entry.reviewMeta?.headerLine || "Revisión automática entre especialistas" }}
                  </span>
                </span>
                <span class="text-[10px] text-[#B5AEA4] shrink-0 tabular-nums">
                  Ronda {{ entry.reviewMeta?.round || 1 }}/{{ entry.reviewMeta?.maxRounds || 2 }}
                  ·
                  {{
                    entry.reviewMeta?.escalated
                      ? "Escalada"
                      : entry.reviewMeta?.dispatched
                        ? "Despachada"
                        : "Registrada"
                  }}
                </span>
              </div>

              <div
                v-if="entry.reviewMeta?.files?.length"
                class="font-mono text-[10px] text-[#F6C894] break-all select-text"
              >
                {{ entry.reviewMeta.files.join(" · ") }}
              </div>

              <div
                class="text-xs text-[#F3EFE8] whitespace-pre-wrap select-text leading-relaxed"
              >
                {{ entry.content }}
              </div>

              <div
                v-if="entry.reviewMeta?.dispatchError"
                class="text-[10px] text-[#FDA4AF]"
              >
                {{ entry.reviewMeta.dispatchError }}
              </div>
            </div>

            <!-- Delegación humana plegable (sin ruido técnico) -->
            <details
              v-else-if="entry.kind === 'tool' && entry.isDelegation"
              @toggle="handleToggleChildThread(entry.childSessionId, $event)"
              class="rounded-xl bg-white/[0.04] border border-white/[0.07]"
            >
              <summary
                class="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-xs text-[#D5CEC4] select-none"
              >
                <span class="flex items-center gap-2 min-w-0 truncate">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    :style="{
                      backgroundColor:
                        profileMap[entry.subagentId || entry.agentId]?.color ||
                        '#E09F5A',
                    }"
                  ></span>
                  <span class="truncate">{{ formatDelegationTitle(entry) }}</span>
                </span>
                <ChevronDown class="w-3.5 h-3.5 text-[#A39B90] shrink-0" />
              </summary>

              <div
                v-if="entry.childSessionId"
                class="px-3 pb-2.5 pt-2 border-t border-white/[0.06] space-y-2"
              >
                <div
                  v-if="
                    getChildHistoryState(entry.childSessionId).status ===
                      'loading' &&
                    getVisibleChildEntries(entry.childSessionId).length === 0
                  "
                  class="h-8 rounded-lg bg-white/[0.05] animate-pulse"
                ></div>
                <div
                  v-else-if="
                    getVisibleChildEntries(entry.childSessionId).length === 0
                  "
                  class="text-[11px] text-[#A39B90]"
                >
                  {{
                    entry.status === "running"
                      ? "Trabajando en la consulta..."
                      : "Consulta completada."
                  }}
                </div>
                <template
                  v-for="subEntry in getVisibleChildEntries(entry.childSessionId)"
                  :key="subEntry.id"
                >
                  <div
                    v-if="subEntry.kind === 'text'"
                    v-html="renderSafeMarkdown(subEntry.content)"
                    class="text-xs text-[#EAE4DC] space-y-1.5 select-text leading-relaxed"
                  ></div>
                  <div
                    v-else-if="subEntry.kind === 'error'"
                    class="text-xs text-[#FDA4AF] select-text"
                  >
                    {{ subEntry.content }}
                  </div>
                </template>
              </div>
            </details>

            <!-- Respuesta natural del agente -->
            <div
              v-else-if="entry.kind === 'text'"
              class="mr-5 rounded-2xl rounded-tl-sm bg-white/[0.06] border border-white/[0.08] px-3.5 py-2.5 space-y-1.5"
            >
              <div class="flex items-center justify-between gap-2 text-[11px]">
                <div class="flex items-center gap-1.5 font-semibold text-[#F6EFE6]">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    :style="{
                      backgroundColor:
                        profileMap[entry.agentId]?.color ||
                        profileMap[commandForm.agent]?.color ||
                        '#E09F5A',
                    }"
                  ></span>
                  <span>{{
                    profileMap[entry.agentId]?.name ||
                    profileMap[commandForm.agent]?.name ||
                    entry.agentId
                  }}</span>
                </div>
                <span
                  v-if="entry.status === 'running'"
                  class="text-[11px] text-[#E09F5A]"
                >
                  Escribiendo...
                </span>
              </div>
              <div
                v-if="entry.content"
                v-html="renderSafeMarkdown(entry.content)"
                class="text-xs text-[#F3EFE8] space-y-1.5 select-text leading-relaxed"
              ></div>
              <div v-else class="text-xs text-[#B5AEA4]">Escribiendo...</div>
            </div>

            <!-- Error legible con botón directo Reintentar -->
            <div
              v-else-if="entry.kind === 'error'"
              class="rounded-xl bg-[#FB7185]/12 border border-[#FB7185]/30 px-3 py-2.5 text-xs text-[#FECDD3] space-y-2 select-text"
            >
              <div class="flex items-start gap-2">
                <AlertTriangle class="w-3.5 h-3.5 text-[#FB7185] shrink-0 mt-0.5" />
                <div class="min-w-0 flex-1 break-words leading-relaxed">
                  {{ entry.content }}
                </div>
              </div>
              <div
                v-if="entry.retryPayload?.text && openCodeState.status === 'connected'"
                class="flex items-center justify-end"
              >
                <button
                  type="button"
                  :disabled="isSendingPrompt"
                  @click="handleRetryFailedPrompt(entry)"
                  class="px-2.5 py-1 rounded-lg bg-[#FB7185]/20 hover:bg-[#FB7185]/30 border border-[#FB7185]/40 text-[11px] font-medium text-[#FFE4E6] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-45"
                >
                  <RotateCcw
                    :class="[
                      'w-3 h-3',
                      retryingEntryId === entry.id ? 'animate-spin' : '',
                    ]"
                  />
                  <span>{{ retryingEntryId === entry.id ? "Reintentando..." : "Reintentar" }}</span>
                </button>
              </div>
            </div>
          </template>

          <!-- Indicador suave cuando el equipo está pensando antes del primer texto -->
          <div
            v-if="showTypingIndicator"
            class="mr-10 rounded-2xl rounded-tl-sm bg-white/[0.04] border border-white/[0.06] px-3.5 py-2 text-xs text-[#C8C0B5]"
          >
            {{ profileMap[commandForm.agent]?.name || "El equipo" }} está preparando una respuesta...
          </div>
        </div>

        <!-- Compositor inferior -->
        <form
          @submit.prevent="handleSendOpenCodePrompt"
          class="p-3.5 border-t border-white/[0.08] space-y-2 shrink-0"
        >
          <textarea
            v-model="commandForm.prompt"
            rows="2"
            :disabled="openCodeState.status !== 'connected'"
            @keydown="handleComposerKeydown"
            :placeholder="
              openCodeState.status === 'connected'
                ? `Escribe a ${profileMap[commandForm.agent]?.name || 'este miembro'}... (Enter para enviar)`
                : 'Conecta el servidor para escribir al equipo...'
            "
            class="w-full px-3 py-2 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] placeholder:text-[#8C847A] focus:outline-none focus:border-[#E09F5A]/60 resize-none disabled:opacity-50"
          ></textarea>

          <div class="flex items-center justify-between gap-2">
            <span
              v-if="commandFeedback"
              :class="[
                'text-[11px] truncate',
                commandFeedback.ok ? 'text-[#34D399]' : 'text-[#FDA4AF]',
              ]"
            >
              {{ commandFeedback.text }}
            </span>
            <span v-else class="text-[11px] text-[#8C847A]">
              Shift+Enter para salto de línea
            </span>

            <div class="flex items-center gap-1.5 shrink-0">
              <button
                v-if="isChatBusy"
                type="button"
                :disabled="isInterrupting"
                @click="handleInterruptOpenCode"
                class="px-3 py-1.5 rounded-xl bg-[#FB7185]/16 hover:bg-[#FB7185]/24 border border-[#FB7185]/35 text-xs font-medium text-[#FECDD3] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Square class="w-3 h-3 fill-current" />
                <span>{{ isInterrupting ? "Deteniendo..." : "Detener" }}</span>
              </button>

              <button
                type="submit"
                :disabled="
                  openCodeState.status !== 'connected' ||
                  isSendingPrompt ||
                  !commandForm.prompt.trim()
                "
                class="px-3.5 py-1.5 rounded-xl bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-45"
              >
                <Send class="w-3.5 h-3.5" />
                <span>{{ isSendingPrompt ? "Enviando..." : "Enviar" }}</span>
              </button>
            </div>
          </div>
        </form>
      </aside>
    </transition>

    <!-- ZONA 4B: Modal Independiente de Conexión y Configuración Técnica -->
    <transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isReady && isSettingsModalOpen"
        @click.self="isSettingsModalOpen = false"
        class="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
      >
        <div
          class="w-[min(560px,95vw)] max-h-[86vh] hud-glass-elevated rounded-2xl flex flex-col overflow-hidden"
        >
          <!-- Cabecera Modal -->
          <div
            class="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <span
                :class="[
                  'w-2.5 h-2.5 rounded-full shrink-0',
                  openCodeState.status === 'connected'
                    ? 'bg-[#34D399]'
                    : openCodeState.status === 'connecting'
                      ? 'bg-[#F59E0B]'
                      : openCodeState.status === 'error'
                        ? 'bg-[#FB7185]'
                        : 'bg-[#78716C]',
                ]"
              ></span>
              <h2 class="text-sm font-semibold text-[#F6EFE6] truncate">
                Conexión y ajustes técnicos
              </h2>
            </div>

            <button
              type="button"
              @click="isSettingsModalOpen = false"
              aria-label="Cerrar ajustes"
              class="p-1.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <!-- Navegación interna de ajustes -->
          <div class="px-5 pt-3 shrink-0">
            <div
              class="grid grid-cols-4 gap-1 p-1 rounded-xl bg-black/25 border border-white/[0.08]"
            >
              <button
                type="button"
                @click="settingsTab = 'connection'"
                :class="[
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer text-center whitespace-nowrap',
                  settingsTab === 'connection'
                    ? 'bg-white/[0.1] text-[#FFFDF9]'
                    : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                ]"
              >
                Conexión
              </button>
              <button
                type="button"
                @click="settingsTab = 'workspace'"
                :class="[
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer text-center whitespace-nowrap',
                  settingsTab === 'workspace'
                    ? 'bg-white/[0.1] text-[#FFFDF9]'
                    : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                ]"
              >
                Proyecto
              </button>
              <button
                type="button"
                @click="settingsTab = 'mapping'"
                :class="[
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer text-center whitespace-nowrap',
                  settingsTab === 'mapping'
                    ? 'bg-white/[0.1] text-[#FFFDF9]'
                    : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                ]"
              >
                Equipo
              </button>
              <button
                type="button"
                @click="settingsTab = 'guide'"
                :class="[
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer text-center whitespace-nowrap',
                  settingsTab === 'guide'
                    ? 'bg-white/[0.1] text-[#FFFDF9]'
                    : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                ]"
              >
                Guía
              </button>
            </div>
          </div>

          <!-- Tab Conexión -->
          <div
            v-if="settingsTab === 'connection'"
            class="flex-1 min-h-0 overflow-y-auto p-5 space-y-4"
          >
            <div class="space-y-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-[11px] text-[#B5AEA4]">Modo de enlace</span>
                <div
                  class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/25 border border-white/[0.08]"
                >
                  <button
                    type="button"
                    @click="openCodeForm.mode = 'direct'"
                    :class="[
                      'px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer',
                      openCodeForm.mode === 'direct'
                        ? 'bg-white/[0.1] text-[#FFFDF9]'
                        : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                    ]"
                  >
                    Directo :4096
                  </button>
                  <button
                    type="button"
                    @click="openCodeForm.mode = 'bridge'"
                    :class="[
                      'px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer',
                      openCodeForm.mode === 'bridge'
                        ? 'bg-white/[0.1] text-[#FFFDF9]'
                        : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                    ]"
                  >
                    Puente :4097
                  </button>
                </div>
              </div>

              <label class="flex flex-col gap-1.5 text-[11px] text-[#B5AEA4]">
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
                  class="px-3 py-2 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60 tabular-nums"
                />
                <input
                  v-else
                  v-model="openCodeForm.bridgeUrl"
                  type="text"
                  placeholder="http://127.0.0.1:4097"
                  class="px-3 py-2 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60 tabular-nums"
                />
              </label>

              <div class="grid grid-cols-3 gap-2.5">
                <label class="flex flex-col gap-1 text-[11px] text-[#B5AEA4]">
                  <span>Usuario</span>
                  <input
                    v-model="openCodeForm.username"
                    type="text"
                    placeholder="opencode"
                    class="px-2.5 py-1.5 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60"
                  />
                </label>

                <label class="flex flex-col gap-1 text-[11px] text-[#B5AEA4]">
                  <span>Clave</span>
                  <input
                    v-model="openCodeForm.password"
                    type="password"
                    placeholder="••••••"
                    class="px-2.5 py-1.5 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60"
                  />
                </label>

                <label class="flex flex-col gap-1 text-[11px] text-[#B5AEA4]">
                  <span>Cooldown (s)</span>
                  <input
                    v-model.number="openCodeForm.idleCooldownSec"
                    type="number"
                    min="5"
                    max="60"
                    class="px-2.5 py-1.5 rounded-xl bg-black/25 border border-white/[0.08] text-xs tabular-nums text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60"
                  />
                </label>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                @click="handleToggleOpenCodeConnection"
                :class="[
                  'px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap',
                  openCodeState.status === 'connected' ||
                  openCodeState.status === 'connecting'
                    ? 'bg-[#FB7185]/16 hover:bg-[#FB7185]/24 border border-[#FB7185]/35 text-[#FECDD3]'
                    : 'bg-[#E09F5A] hover:bg-[#E7AF72] text-[#1B1714]',
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
                class="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-xs font-medium text-[#F3EFE8] cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                {{ isTestingConnection ? "Probando..." : "Probar conexión" }}
              </button>

              <button
                type="button"
                @click="saveOpenCodeConfig"
                class="px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-xs font-medium text-[#D5CEC4] cursor-pointer whitespace-nowrap"
              >
                Guardar ajuste
              </button>
            </div>

            <!-- Preferencias de segundo monitor: Autoconexión, Audio y Notificaciones -->
            <div class="rounded-xl bg-black/20 border border-white/[0.08] p-3.5 space-y-3">
              <label class="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div class="text-xs font-medium text-[#F6EFE6]">
                    Conectar automáticamente al abrir
                  </div>
                  <div class="text-[11px] text-[#A39B90]">
                    Enlaza con tu puente OpenCode al iniciar la oficina
                  </div>
                </div>
                <input
                  v-model="openCodeForm.autoConnect"
                  @change="saveOpenCodeConfig"
                  type="checkbox"
                  class="accent-[#E09F5A] w-4 h-4 cursor-pointer"
                />
              </label>

              <div class="pt-2 border-t border-white/[0.07] space-y-1.5">
                <div class="text-xs font-medium text-[#F6EFE6]">
                  Audio de la oficina
                </div>
                <div class="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/30 border border-white/[0.07]">
                  <button
                    type="button"
                    @click="handleSetAudioMode('alerts')"
                    :class="[
                      'px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer whitespace-nowrap',
                      audioMode === 'alerts'
                        ? 'bg-white/[0.12] text-[#FFFDF9]'
                        : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                    ]"
                  >
                    Solo avisos
                  </button>
                  <button
                    type="button"
                    @click="handleSetAudioMode('ambient')"
                    :class="[
                      'px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer whitespace-nowrap',
                      audioMode === 'ambient'
                        ? 'bg-white/[0.12] text-[#FFFDF9]'
                        : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                    ]"
                  >
                    Ambiente + avisos
                  </button>
                  <button
                    type="button"
                    @click="handleSetAudioMode('muted')"
                    :class="[
                      'px-2 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer whitespace-nowrap',
                      audioMode === 'muted'
                        ? 'bg-white/[0.12] text-[#FFFDF9]'
                        : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
                    ]"
                  >
                    Silencio
                  </button>
                </div>
              </div>

              <div class="pt-2 border-t border-white/[0.07] flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs font-medium text-[#F6EFE6] flex items-center gap-1.5">
                    <Bell class="w-3.5 h-3.5 text-[#E09F5A]" />
                    <span>Avisos de escritorio en segundo plano</span>
                  </div>
                  <div class="text-[11px] text-[#A39B90]">
                    Notifica preguntas y permisos solo cuando esta pestaña está oculta
                  </div>
                </div>
                <button
                  type="button"
                  @click="handleToggleDesktopNotifications"
                  :disabled="desktopNotifPermission === 'unsupported' || desktopNotifPermission === 'denied'"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45',
                    desktopNotifEnabled
                      ? 'bg-[#34D399]/20 border border-[#34D399]/40 text-[#A7F3D0]'
                      : 'bg-white/[0.07] border border-white/[0.08] text-[#DDD6CD] hover:text-[#FFFDF9]',
                  ]"
                >
                  {{
                    desktopNotifPermission === "denied"
                      ? "Bloqueado"
                      : desktopNotifEnabled
                        ? "Activado"
                        : "Activar"
                  }}
                </button>
              </div>
            </div>

            <div
              class="rounded-xl bg-black/20 border border-white/[0.08] px-3.5 py-2.5 flex items-center justify-between text-xs text-[#C8C0B5] tabular-nums"
            >
              <span>
                Estado:
                <strong class="font-medium text-[#F3EFE8]">
                  {{
                    openCodeState.status === "connected"
                      ? "Conectado"
                      : openCodeState.status === "connecting"
                        ? "Conectando"
                        : openCodeState.status === "error"
                          ? "Con error"
                          : "Desconectado"
                  }}
                </strong>
              </span>
              <span>Sesiones: {{ openCodeState.sessionsCount }}</span>
              <span>Activos: {{ openCodeState.activeAgents.length }}/5</span>
            </div>

            <div
              v-if="testResult || openCodeState.lastError"
              class="rounded-xl bg-black/20 border border-white/[0.08] px-3.5 py-2.5 text-xs space-y-1"
            >
              <div
                v-if="testResult"
                :class="testResult.ok ? 'text-[#34D399]' : 'text-[#FDA4AF]'"
              >
                {{
                  testResult.ok
                    ? `Servidor accesible (${testResult.latencyMs} ms · ${testResult.sessionsCount} sesiones detectadas)`
                    : `Diagnóstico: ${testResult.error}`
                }}
              </div>
              <div v-if="openCodeState.lastError" class="text-[#FDA4AF]">
                {{ openCodeState.lastError }}
              </div>
            </div>

            <!-- Diagnóstico rápido en vivo (directorio, SSE y últimos errores del puente) -->
            <div class="rounded-xl bg-black/20 border border-white/[0.08] p-3.5 space-y-2.5 text-xs">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 font-medium text-[#F6EFE6]">
                  <Activity class="w-3.5 h-3.5 text-[#E09F5A]" />
                  <span>Diagnóstico en vivo</span>
                </div>
                <button
                  type="button"
                  :disabled="isLoadingDiagnostics"
                  @click="handleRefreshDiagnostics"
                  class="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[11px] font-medium text-[#EAE4DC] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                >
                  <RefreshCw
                    :class="['w-3 h-3', isLoadingDiagnostics ? 'animate-spin' : '']"
                  />
                  <span>{{ isLoadingDiagnostics ? "Comprobando..." : "Comprobar ahora" }}</span>
                </button>
              </div>

              <div v-if="bridgeDiagnostics && !bridgeDiagnostics.offline" class="space-y-2">
                <!-- Verificación de carpeta puente vs OpenCode -->
                <div class="rounded-lg bg-black/25 border border-white/[0.06] p-2.5 space-y-1.5">
                  <div class="flex items-center justify-between gap-2 text-[11px]">
                    <span class="text-[#A39B90]">Proyecto activo en puente</span>
                    <span
                      v-if="bridgeDiagnostics.directoryMatches === true"
                      class="text-[#34D399] flex items-center gap-1 font-medium whitespace-nowrap"
                    >
                      <CheckCircle2 class="w-3 h-3" />
                      <span>Sincronizado con :4096</span>
                    </span>
                    <span
                      v-else-if="bridgeDiagnostics.directoryMatches === false"
                      class="text-[#FBBF24] flex items-center gap-1 font-medium whitespace-nowrap"
                    >
                      <AlertTriangle class="w-3 h-3" />
                      <span>Carpeta distinta en :4096</span>
                    </span>
                    <span v-else class="text-[#A39B90] whitespace-nowrap">
                      {{ bridgeDiagnostics.upstreamOk ? "Enlazado por cabecera" : "Sin respuesta de :4096" }}
                    </span>
                  </div>
                  <div class="font-mono text-[11px] text-[#EAE4DC] break-all select-text">
                    {{ bridgeDiagnostics.bridgeProjectDir || "No configurado" }}
                  </div>
                  <div
                    v-if="bridgeDiagnostics.openCodeDirectory"
                    class="pt-1 border-t border-white/[0.06] text-[11px]"
                  >
                    <span class="text-[#A39B90]">Reportado por OpenCode: </span>
                    <span
                      :class="[
                        'font-mono break-all select-text',
                        bridgeDiagnostics.directoryMatches === false
                          ? 'text-[#FDE68A]'
                          : 'text-[#C8C0B5]',
                      ]"
                    >
                      {{ bridgeDiagnostics.openCodeDirectory }}
                    </span>
                  </div>
                </div>

                <!-- Estado SSE y sesiones filtradas -->
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] tabular-nums">
                  <div class="rounded-lg bg-black/20 border border-white/[0.06] px-2.5 py-1.5">
                    <div class="text-[#8C847A]">Stream SSE</div>
                    <div
                      :class="[
                        'font-medium mt-0.5',
                        openCodeState.status === 'connected'
                          ? 'text-[#34D399]'
                          : openCodeState.status === 'connecting'
                            ? 'text-[#FBBF24]'
                            : 'text-[#FDA4AF]',
                      ]"
                    >
                      {{
                        openCodeState.status === "connected"
                          ? `Activo (${formatDiagTime(bridgeDiagnostics.lastSseEventAt || openCodeState.lastChunkAt)})`
                          : openCodeState.status === "connecting"
                            ? "Reconectando..."
                            : "Inactivo"
                      }}
                    </div>
                  </div>
                  <div class="rounded-lg bg-black/20 border border-white/[0.06] px-2.5 py-1.5">
                    <div class="text-[#8C847A]">Sesiones proyecto</div>
                    <div class="font-medium text-[#F3EFE8] mt-0.5">
                      {{ openCodeState.sessionsCount }}
                      <span
                        v-if="openCodeState.filteredOutSessionsCount > 0"
                        class="text-[#A39B90] font-normal"
                      >
                        ({{ openCodeState.filteredOutSessionsCount }} externas ocultas)
                      </span>
                    </div>
                  </div>
                  <div class="rounded-lg bg-black/20 border border-white/[0.06] px-2.5 py-1.5 col-span-2 sm:col-span-1">
                    <div class="text-[#8C847A]">Errores puente</div>
                    <div
                      :class="[
                        'font-medium mt-0.5',
                        (bridgeDiagnostics.recentErrors?.length || 0) > 0
                          ? 'text-[#FDA4AF]'
                          : 'text-[#34D399]',
                      ]"
                    >
                      {{ bridgeDiagnostics.recentErrors?.length || 0 }} recientes
                    </div>
                  </div>
                </div>

                <!-- Comando recomendado con trazas DEBUG -->
                <div class="rounded-lg bg-black/25 border border-white/[0.06] px-2.5 py-2 flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-[10px] text-[#A39B90]">
                      Comando recomendado para ver logs en vivo en la terminal de OpenCode:
                    </div>
                    <div class="font-mono text-[10px] text-[#F6C894] truncate select-text mt-0.5">
                      {{ bridgeDiagnostics.recommendedCommand || OPENCODE_CLI_COMMANDS.serveDebug }}
                    </div>
                  </div>
                  <button
                    type="button"
                    @click="copySnippet('serveDebug', bridgeDiagnostics.recommendedCommand || OPENCODE_CLI_COMMANDS.serveDebug)"
                    class="px-2 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-[10px] text-[#F3EFE8] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Check v-if="copiedKey === 'serveDebug'" class="w-3 h-3 text-[#34D399]" />
                    <Copy v-else class="w-3 h-3" />
                    <span>{{ copiedKey === "serveDebug" ? "Copiado" : "Copiar" }}</span>
                  </button>
                </div>

                <!-- Errores recientes colapsables -->
                <div
                  v-if="bridgeDiagnostics.recentErrors?.length > 0"
                  class="rounded-lg bg-[#FB7185]/[0.07] border border-[#FB7185]/25 overflow-hidden"
                >
                  <button
                    type="button"
                    @click="showDiagErrors = !showDiagErrors"
                    class="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] text-[#FECDD3] hover:bg-white/[0.04] cursor-pointer"
                  >
                    <span>
                      Últimos errores del puente ({{ bridgeDiagnostics.recentErrors.length }})
                    </span>
                    <ChevronDown
                      :class="[
                        'w-3.5 h-3.5 transition-transform',
                        showDiagErrors ? 'rotate-180' : '',
                      ]"
                    />
                  </button>
                  <div
                    v-if="showDiagErrors"
                    class="px-2.5 pb-2 space-y-1.5 max-h-36 overflow-y-auto border-t border-[#FB7185]/20 pt-1.5"
                  >
                    <div
                      v-for="errItem in bridgeDiagnostics.recentErrors"
                      :key="errItem.id"
                      class="font-mono text-[10px] text-[#FFE4E6] flex items-start justify-between gap-2"
                    >
                      <span class="break-all">
                        [{{ errItem.status }}] {{ errItem.method }} {{ errItem.path }} · {{ errItem.detail }}
                      </span>
                      <span class="text-[#FDA4AF]/75 shrink-0 tabular-nums">
                        {{ formatDiagTime(errItem.timestamp) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="text-[11px] text-[#A39B90]">
                Inicia el puente local (<span class="font-mono text-[#F6C894]">npm run opencode:bridge</span>) y pulsa <strong>Comprobar ahora</strong> para inspeccionar el estado real de OpenCode.
              </div>
            </div>
          </div>

          <!-- Tab Proyecto / Workspace -->
          <div
            v-else-if="settingsTab === 'workspace'"
            class="flex-1 min-h-0 overflow-y-auto p-5 space-y-4"
          >
            <div class="rounded-xl bg-black/20 border border-white/[0.08] p-4 space-y-3">
              <div class="flex items-center gap-2 text-xs font-semibold text-[#F6EFE6]">
                <FolderOpen class="w-4 h-4 text-[#E09F5A]" />
                <span>Carpeta del proyecto activo</span>
              </div>
              <p class="text-[11px] text-[#B5AEA4] leading-relaxed">
                Define qué repositorio local inspeccionan el puente (:4097), los monitores 3D y la pizarra de arquitectura.
              </p>

              <div class="flex items-center gap-2">
                <input
                  v-model="workspaceDirInput"
                  type="text"
                  placeholder="Ej: C:\Users\tu-usuario\proyectos\mi-app"
                  class="flex-1 min-w-0 px-3 py-2 rounded-xl bg-black/30 border border-white/[0.08] text-xs font-mono text-[#F3EFE8] placeholder:text-[#8C847A] focus:outline-none focus:border-[#E09F5A]/60"
                />
                <button
                  type="button"
                  @click="handleApplyWorkspaceDir"
                  :disabled="isApplyingWorkspaceDir || !workspaceDirInput.trim()"
                  class="px-3.5 py-2 rounded-xl bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
                >
                  {{ isApplyingWorkspaceDir ? "Aplicando..." : "Aplicar" }}
                </button>
              </div>

              <div
                v-if="workspaceDirFeedback"
                :class="[
                  'text-[11px]',
                  workspaceDirFeedback.ok ? 'text-[#34D399]' : 'text-[#FDA4AF]',
                ]"
              >
                {{ workspaceDirFeedback.text }}
              </div>
            </div>

            <div class="rounded-xl bg-black/20 border border-white/[0.08] p-4 space-y-2 text-xs text-[#C8C0B5]">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[#A39B90]">Proyecto</span>
                <span class="font-medium text-[#F6EFE6]">
                  {{ workspaceSummary?.projectName || "Sin datos del puente" }}
                </span>
              </div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-[#A39B90]">Rama Git</span>
                <span class="font-mono text-[#F6C894]">
                  {{
                    workspaceSummary?.isGitRepo
                      ? workspaceSummary.branch || "HEAD"
                      : "No es repo Git"
                  }}
                </span>
              </div>
              <div class="flex items-center justify-between gap-2 tabular-nums">
                <span class="text-[#A39B90]">Archivos modificados</span>
                <span class="text-[#F3EFE8]">{{ workspaceChangedCount }}</span>
              </div>
              <div class="flex items-center justify-between gap-2 tabular-nums">
                <span class="text-[#A39B90]">Notas en pizarra</span>
                <span class="text-[#F3EFE8]">{{ whiteboardNotes.length }}</span>
              </div>
              <div class="pt-2 border-t border-white/[0.07] text-[11px] text-[#9C948A] leading-relaxed">
                Las notas de la pizarra y tu carpeta activa se guardan en <span class="font-mono text-[#DDD6CD]">~/.opencode-office-3d/</span> fuera del historial Git de tu repositorio.
              </div>
            </div>
          </div>

          <!-- Tab Equipo (Personalización de avatares + Mapeo de alias) -->
          <div
            v-else-if="settingsTab === 'mapping'"
            class="flex-1 min-h-0 overflow-y-auto p-5 space-y-3"
          >
            <div class="space-y-2.5">
              <div
                v-for="ag in agentList"
                :key="ag.id"
                class="rounded-xl bg-black/20 border border-white/[0.08] p-3.5 space-y-2.5"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      :style="{ backgroundColor: profileDrafts[ag.id]?.color || ag.color }"
                    ></span>
                    <span class="text-xs font-semibold text-[#F6EFE6] truncate">
                      {{ profileDrafts[ag.id]?.name || ag.name }}
                    </span>
                    <span class="text-[11px] text-[#A39B90]">({{ ag.id }})</span>
                  </div>
                  <span
                    :class="[
                      'text-[11px] font-medium shrink-0',
                      openCodeState.activeAgents.includes(ag.id)
                        ? 'text-[#34D399]'
                        : 'text-[#8C847A]',
                    ]"
                  >
                    {{
                      openCodeState.activeAgents.includes(ag.id)
                        ? "Activo"
                        : "Disponible"
                    }}
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <input
                    v-model="profileDrafts[ag.id].name"
                    type="text"
                    maxlength="20"
                    placeholder="Nombre visible"
                    class="px-2.5 py-1.5 rounded-lg bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60"
                  />
                  <input
                    v-model="profileDrafts[ag.id].role"
                    type="text"
                    maxlength="28"
                    placeholder="Rol"
                    class="px-2.5 py-1.5 rounded-lg bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] focus:outline-none focus:border-[#E09F5A]/60"
                  />
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5">
                    <button
                      v-for="swatch in AGENT_COLOR_PALETTE"
                      :key="swatch.hex"
                      type="button"
                      @click="profileDrafts[ag.id].color = swatch.hex"
                      :title="swatch.name"
                      :class="[
                        'w-4 h-4 rounded-full cursor-pointer transition-transform',
                        profileDrafts[ag.id].color === swatch.hex
                          ? 'ring-2 ring-white scale-110'
                          : 'opacity-70 hover:opacity-100',
                      ]"
                      :style="{ backgroundColor: swatch.hex }"
                    ></button>
                  </div>
                  <input
                    v-model="aliasDraft[ag.id]"
                    type="text"
                    placeholder="alias1, alias2"
                    title="Alias de agente OpenCode"
                    class="w-44 px-2 py-1 rounded-lg bg-black/25 border border-white/[0.08] text-[11px] font-mono text-[#D5CEC4] focus:outline-none focus:border-[#E09F5A]/60"
                  />
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <button
                type="button"
                @click="handleSaveTeamAndAliases"
                class="px-3.5 py-2 rounded-xl bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] cursor-pointer whitespace-nowrap"
              >
                Guardar equipo
              </button>
              <button
                type="button"
                @click="handleResetTeamAndAliases"
                class="px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-xs font-medium text-[#D5CEC4] cursor-pointer whitespace-nowrap"
              >
                Restaurar
              </button>
            </div>
          </div>

          <!-- Tab Guía de Instalación -->
          <div
            v-else
            class="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 text-xs text-[#DDD6CD]"
          >
            <div class="space-y-2">
              <p class="font-semibold text-[#F6EFE6]">
                Cómo conectar OpenCode en tu equipo:
              </p>
              <ol class="space-y-1.5 list-decimal list-inside leading-relaxed text-[#C8C0B5]">
                <li>
                  Coloca <span class="text-[#F6C894]">opencode.json</span> en tu
                  proyecto o en <span class="text-[#F3EFE8]">~/.config/opencode/opencode.json</span>.
                </li>
                <li>
                  Inicia el servidor local de OpenCode con CORS habilitado (o el
                  puente local en el puerto 4097).
                </li>
                <li>
                  Pulsa <strong>Conectar</strong> en la pestaña Conexión para sincronizar al equipo.
                </li>
              </ol>
            </div>

            <div class="space-y-2">
              <div
                class="flex items-center justify-between gap-2 rounded-xl bg-black/25 border border-white/[0.08] px-3 py-2"
              >
                <span class="text-[11px] text-[#F6C894] truncate select-text">
                  {{ OPENCODE_CLI_COMMANDS.serveDirect }}
                </span>
                <button
                  type="button"
                  @click="copySnippet('serve', OPENCODE_CLI_COMMANDS.serveDirect)"
                  class="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-[11px] text-[#F3EFE8] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Check
                    v-if="copiedKey === 'serve'"
                    class="w-3 h-3 text-[#34D399]"
                  />
                  <Copy v-else class="w-3 h-3" />
                  <span>{{ copiedKey === "serve" ? "Copiado" : "Copiar" }}</span>
                </button>
              </div>

              <div
                class="flex items-center justify-between gap-2 rounded-xl bg-black/25 border border-white/[0.08] px-3 py-2"
              >
                <span class="text-[11px] text-[#C8C0B5] truncate select-text">
                  {{ OPENCODE_CLI_COMMANDS.runBridge }} ·
                  {{ OPENCODE_CLI_COMMANDS.attachTui }}
                </span>
                <button
                  type="button"
                  @click="copySnippet('bridge', OPENCODE_CLI_COMMANDS.runBridge)"
                  class="px-2.5 py-1 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-[11px] text-[#F3EFE8] flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Check
                    v-if="copiedKey === 'bridge'"
                    class="w-3 h-3 text-[#34D399]"
                  />
                  <Copy v-else class="w-3 h-3" />
                  <span>{{ copiedKey === "bridge" ? "Copiado" : "Puente" }}</span>
                </button>
              </div>
            </div>

            <div class="space-y-2">
              <div class="flex flex-wrap items-center justify-between gap-1.5">
                <span class="font-medium text-[#F6EFE6]">Plantilla opencode.json</span>
                <div class="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    @click="downloadOpenCodeReport"
                    class="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-[11px] font-medium text-[#F3EFE8] flex items-center gap-1 cursor-pointer"
                  >
                    <Download class="w-3 h-3" />
                    <span>Guía .md</span>
                  </button>
                  <button
                    type="button"
                    @click="downloadOpenCodeJson"
                    class="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-[11px] font-medium text-[#F3EFE8] flex items-center gap-1 cursor-pointer"
                  >
                    <Download class="w-3 h-3" />
                    <span>.json</span>
                  </button>
                  <button
                    type="button"
                    @click="copySnippet('json', OPENCODE_JSON_SNIPPET)"
                    class="px-2.5 py-1 rounded-lg bg-[#E09F5A] hover:bg-[#E7AF72] text-[11px] font-semibold text-[#1B1714] flex items-center gap-1 cursor-pointer"
                  >
                    <Check v-if="copiedKey === 'json'" class="w-3 h-3" />
                    <Copy v-else class="w-3 h-3" />
                    <span>{{
                      copiedKey === "json" ? "Copiado" : "Copiar JSON"
                    }}</span>
                  </button>
                </div>
              </div>
              <pre
                class="rounded-xl bg-black/25 border border-white/[0.08] p-3 text-[11px] text-[#D5CEC4] overflow-auto max-h-48 leading-relaxed select-text"
              >{{ OPENCODE_JSON_SNIPPET }}</pre>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <!-- Tooltip discreto al pasar el cursor sobre mobiliario 3D interactivo -->
    <div
      v-if="isReady && hoveredProp && !anyFloatingModalOpen"
      class="fixed top-0 left-0 z-40 pointer-events-none hud-glass rounded-xl px-2.5 py-1.5 text-[11px] max-w-[230px]"
      :style="hoverTooltipStyle"
    >
      <div class="font-semibold text-[#F6EFE6] truncate">
        {{ hoveredProp.label }}
      </div>
      <div v-if="hoveredProp.hint" class="text-[10px] text-[#C8C0B5] truncate">
        {{ hoveredProp.hint }}
      </div>
    </div>

    <!-- ZONA 4C: Modal Flotante Cristalino — Inspector Git y Actividad Técnica -->
    <GitActivityInspectorModal
      :open="isReady && isInspectorOpen"
      :initial-tab="inspectorInitialTab"
      :initial-agent-id="inspectorAgentId"
      :profiles="profiles"
      :workspace="workspaceSummary"
      :tool-activity="toolActivityList"
      :is-connected="openCodeState.status === 'connected'"
      @close="isInspectorOpen = false"
      @dispatch-prompt="handleInspectorDispatchPrompt"
      @open-settings="
        (tab) => {
          isInspectorOpen = false;
          openSettingsModal(tab || 'workspace');
        }
      "
    />

    <!-- ZONA 4D: Modal Flotante Cristalino — Pizarra de Arquitectura -->
    <WhiteboardModal
      :open="isReady && isWhiteboardOpen"
      :notes="whiteboardNotes"
      :project-name="workspaceSummary?.projectName || ''"
      @close="isWhiteboardOpen = false"
      @updated="
        (notes) => {
          whiteboardNotes = notes;
        }
      "
    />

    <!-- ZONA 4E: Modal Flotante Cristalino — Standup Rápido -->
    <QuickStandupModal
      :open="isReady && isStandupOpen"
      :is-connected="openCodeState.status === 'connected'"
      @close="isStandupOpen = false"
      @launch-standup="handleLaunchStandup"
    />
  </main>
</template>
