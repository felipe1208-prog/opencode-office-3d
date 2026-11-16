<script setup>
import { onMounted, ref, reactive, computed, onBeforeUnmount } from "vue";
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

const canvasRef = ref(null);
const loadProgress = ref(0);
const isReady = ref(false);
const selectedAgentId = ref(null);
const timeMode = ref("day"); // 'day' | 'night' | 'auto'
const isDockCollapsed = ref(false);
const showBubbles = ref(true);
const isTaskBoardOpen = ref(false);
const isOpenCodePanelOpen = ref(false);
const openCodeTab = ref("connection"); // 'connection' | 'command' | 'mapping' | 'guide'
const activeInspectorTab = ref("routes"); // 'routes' | 'animations' | 'events' | 'profile'
const eventLog = ref([]);

const profiles = ref(agentProfileManager.getProfiles());
const tasks = ref(taskBoardManager.getTasks());
const taskSourceFilter = ref("all"); // 'all' | 'opencode' | 'manual'
const audioEnabled = ref(false);
const audioVolume = ref(0.45);

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
let copyFeedbackTimer = null;

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
    if (!commandForm.sessionId || !availableIds.has(commandForm.sessionId)) {
      commandForm.sessionId =
        snap.activeSessionId || snap.sessions?.[0]?.id || "";
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
  });
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
  experience.setSimulationSpeed(directorState.speedMultiplier === 1 ? 2 : 1);
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
    isDockCollapsed.value = false;
  }
  ambientAudio.playSoftTick();
}

function toggleOpenCodePanel() {
  isOpenCodePanelOpen.value = !isOpenCodePanelOpen.value;
  if (isOpenCodePanelOpen.value) {
    isTaskBoardOpen.value = false;
    isDockCollapsed.value = false;
  }
  ambientAudio.playSoftTick();
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
  isDockCollapsed.value = false;
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
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
  openCodeBridge.dispose();
  ambientAudio.dispose();
  experience?.destroy();
});
</script>

<template>
  <main
    class="w-full h-screen relative bg-slate-950 overflow-hidden font-sans select-none text-slate-100"
  >
    <!-- Contenedor aislado del Canvas WebGL -->
    <div class="w-full h-full relative">
      <canvas ref="canvasRef" class="w-full h-full block outline-none" />
    </div>

    <!-- Pantalla de carga inicial -->
    <div
      v-if="!isReady"
      class="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-6 z-50"
    >
      <div class="w-80 space-y-3">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium text-slate-200"
            >Inicializando Oficina Virtual 3D</span
          >
          <span class="font-mono tabular-nums">{{ loadProgress }}%</span>
        </div>
        <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            class="h-full bg-sky-500 transition-all duration-150 ease-out"
            :style="{ width: `${loadProgress}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- Título discreto superior izquierdo (sin ocluir el centro del diorama) -->
    <div
      v-if="isReady"
      class="absolute top-4 left-5 z-20 pointer-events-none flex items-center gap-3 px-3.5 py-2 rounded-lg bg-slate-950/88 border border-slate-800"
    >
      <h1 class="text-sm font-semibold tracking-tight text-slate-100">
        Oficina Virtual 3D
      </h1>
      <span aria-hidden="true" class="text-slate-600">·</span>
      <span class="text-xs text-slate-400">
        {{
          openCodeState.status === "connected"
            ? "Híbrido OpenCode"
            : directorState.paused
              ? "Simulación en pausa"
              : "Simulación autónoma"
        }}
      </span>
    </div>

    <!-- Acceso directo superior derecho a OpenCode CLI (siempre visible) -->
    <div
      v-if="isReady"
      class="absolute top-4 right-5 z-30 flex items-center gap-2 pointer-events-auto"
    >
      <button
        v-if="openCodeState.status === 'connected'"
        type="button"
        @click="openCommandComposer"
        class="px-3 py-2 rounded-lg border border-sky-500/45 bg-sky-600/20 hover:bg-sky-600/30 text-xs font-medium text-sky-100 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-lg"
      >
        <Send class="w-3.5 h-3.5 text-sky-300" />
        <span>Comando</span>
      </button>

      <button
        type="button"
        @click="toggleOpenCodePanel"
        :class="[
          'px-3 py-2 rounded-lg border text-xs font-medium flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shadow-lg',
          isOpenCodePanelOpen || openCodeState.status === 'connected'
            ? 'bg-sky-600/25 border-sky-500/50 text-sky-100'
            : openCodeState.status === 'error'
              ? 'bg-rose-950/92 border-rose-500/50 text-rose-200'
              : 'bg-slate-950/92 border-slate-700 text-slate-100 hover:bg-slate-900 hover:border-sky-500/50',
        ]"
      >
        <Terminal class="w-3.5 h-3.5 text-sky-400" />
        <span>OpenCode</span>
        <span aria-hidden="true" class="text-slate-600">·</span>
        <span
          :class="[
            'font-mono text-[11px] tabular-nums',
            openCodeState.status === 'connected'
              ? 'text-emerald-300'
              : openCodeState.status === 'error'
                ? 'text-rose-300'
                : 'text-slate-400',
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
      </button>
    </div>

    <!-- Aviso flotante de Permisos CLI pendientes en vivo -->
    <div
      v-if="isReady && activePermission"
      class="absolute top-16 right-5 z-30 w-[min(420px,92vw)] rounded-xl bg-slate-950/94 border border-amber-500/45 shadow-2xl p-3.5 space-y-2.5 pointer-events-auto"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-xs font-semibold text-amber-200">
          <ShieldAlert class="w-4 h-4 text-amber-400 shrink-0" />
          <span>Permiso CLI pendiente</span>
        </div>
        <div class="flex items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
          <span>{{ profileMap[activePermission.agentId]?.name || activePermission.agentId }}</span>
          <span aria-hidden="true" class="text-slate-600">·</span>
          <span>1 de {{ openCodeState.pendingPermissions.length }}</span>
        </div>
      </div>

      <div class="space-y-1">
        <div class="text-xs font-medium text-slate-100">
          {{ activePermission.title }}
          <span aria-hidden="true" class="text-slate-500 mx-1">·</span>
          <span class="font-mono text-sky-300">{{ activePermission.toolName }}</span>
        </div>
        <div class="text-[11px] font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded-md px-2.5 py-1.5 truncate">
          {{ activePermission.targetSummary }}
        </div>
      </div>

      <div v-if="permissionError" class="text-xs text-rose-300">
        {{ permissionError }}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          :disabled="replyingPermissionId === activePermission.id"
          @click="handleReplyPermission(activePermission.id, 'once')"
          class="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
        >
          Permitir una vez
        </button>
        <button
          type="button"
          :disabled="replyingPermissionId === activePermission.id"
          @click="handleReplyPermission(activePermission.id, 'always')"
          class="px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
        >
          Permitir siempre
        </button>
        <button
          type="button"
          :disabled="replyingPermissionId === activePermission.id"
          @click="handleReplyPermission(activePermission.id, 'reject')"
          class="px-2.5 py-1.5 rounded-md bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-xs font-medium text-rose-200 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
        >
          Rechazar
        </button>
      </div>
    </div>

    <!-- Dock inferior colapsable unificado -->
    <section
      v-if="isReady"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center w-[min(1080px,95vw)] pointer-events-none"
    >
      <!-- Botón de colapsar / expandir (Tecla H) -->
      <button
        @click="isDockCollapsed = !isDockCollapsed"
        type="button"
        class="pointer-events-auto mb-1.5 px-3 py-1 rounded-t-md bg-slate-950/92 border border-b-0 border-slate-800 text-[11px] font-medium text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
      >
        <ChevronDown v-if="!isDockCollapsed" class="w-3.5 h-3.5" />
        <ChevronUp v-else class="w-3.5 h-3.5" />
        <span>{{
          isDockCollapsed ? "Mostrar controles (H)" : "Ocultar controles (H)"
        }}</span>
      </button>

      <!-- Cuerpo del Dock + Paneles + Inspector contextual -->
      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-3"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-3"
      >
        <div
          v-show="!isDockCollapsed"
          class="pointer-events-auto w-full rounded-xl bg-slate-950/94 border border-slate-800 shadow-2xl overflow-hidden"
        >
          <!-- Panel Conexión y Configuración OpenCode -->
          <div
            v-if="isOpenCodePanelOpen"
            class="px-5 py-4 border-b border-slate-800 bg-slate-900/80 max-h-[40vh] overflow-y-auto"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
                <Terminal class="w-4 h-4 text-sky-400" />
                <span>Conexión OpenCode CLI</span>
                <span aria-hidden="true" class="text-slate-600">·</span>
                <span
                  :class="[
                    'text-xs font-normal',
                    openCodeState.status === 'connected'
                      ? 'text-emerald-300'
                      : openCodeState.status === 'error'
                        ? 'text-rose-300'
                        : openCodeState.status === 'connecting'
                          ? 'text-amber-300'
                          : 'text-slate-400',
                  ]"
                >
                  {{
                    openCodeState.status === "connected"
                      ? "Conectado (stream SSE activo)"
                      : openCodeState.status === "connecting"
                        ? "Conectando..."
                        : openCodeState.status === "error"
                          ? "Error de enlace"
                          : "Desconectado"
                  }}
                </span>
              </div>

              <div class="flex items-center gap-2">
                <div
                  class="flex items-center gap-1 p-0.5 rounded-md bg-slate-950 border border-slate-800"
                >
                  <button
                    type="button"
                    @click="openCodeTab = 'connection'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      openCodeTab === 'connection'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Conexión
                  </button>
                  <button
                    type="button"
                    @click="openCodeTab = 'command'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      openCodeTab === 'command'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Comando
                  </button>
                  <button
                    type="button"
                    @click="openCodeTab = 'mapping'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      openCodeTab === 'mapping'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Mapeo (5 Agentes)
                  </button>
                  <button
                    type="button"
                    @click="openCodeTab = 'guide'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      openCodeTab === 'guide'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Guía y Config
                  </button>
                </div>

                <button
                  type="button"
                  @click="isOpenCodePanelOpen = false"
                  aria-label="Cerrar panel OpenCode"
                  class="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Pestaña 1: Conexión SSE + Puente -->
            <div v-if="openCodeTab === 'connection'" class="mt-3 space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-end">
                <div class="md:col-span-3 flex flex-col gap-1">
                  <span class="text-[11px] text-slate-400">Modo de enlace</span>
                  <div
                    class="flex items-center gap-1 p-0.5 rounded-md bg-slate-950 border border-slate-800"
                  >
                    <button
                      type="button"
                      @click="openCodeForm.mode = 'direct'"
                      :class="[
                        'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                        openCodeForm.mode === 'direct'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200',
                      ]"
                    >
                      Directo :4096
                    </button>
                    <button
                      type="button"
                      @click="openCodeForm.mode = 'bridge'"
                      :class="[
                        'flex-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                        openCodeForm.mode === 'bridge'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200',
                      ]"
                    >
                      Puente :4097
                    </button>
                  </div>
                </div>

                <label class="md:col-span-4 flex flex-col gap-1 text-[11px] text-slate-400">
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
                    class="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                  <input
                    v-else
                    v-model="openCodeForm.bridgeUrl"
                    type="text"
                    placeholder="http://127.0.0.1:4097"
                    class="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>

                <label class="md:col-span-2 flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Usuario (opcional)</span>
                  <input
                    v-model="openCodeForm.username"
                    type="text"
                    placeholder="opencode"
                    class="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>

                <label class="md:col-span-2 flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Clave (opcional)</span>
                  <input
                    v-model="openCodeForm.password"
                    type="password"
                    placeholder="••••••"
                    class="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>

                <label class="md:col-span-1 flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Cooldown</span>
                  <input
                    v-model.number="openCodeForm.idleCooldownSec"
                    type="number"
                    min="5"
                    max="60"
                    class="px-2 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    @click="handleToggleOpenCodeConnection"
                    :class="[
                      'px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0',
                      openCodeState.status === 'connected' ||
                      openCodeState.status === 'connecting'
                        ? 'bg-rose-600/25 hover:bg-rose-600/35 border border-rose-500/40 text-rose-200'
                        : 'bg-sky-600 hover:bg-sky-500 text-white',
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
                    class="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    {{ isTestingConnection ? "Probando..." : "Probar conexión" }}
                  </button>

                  <button
                    type="button"
                    @click="saveOpenCodeConfig"
                    class="px-2.5 py-1.5 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Guardar ajuste
                  </button>
                </div>

                <div
                  class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-mono tabular-nums"
                >
                  <span>Eventos: {{ openCodeState.eventsReceived }}</span>
                  <span aria-hidden="true" class="text-slate-600">·</span>
                  <span>Sesiones: {{ openCodeState.sessionsCount }}</span>
                  <span aria-hidden="true" class="text-slate-600">·</span>
                  <span>En vivo: {{ openCodeState.activeAgents.length }}/5</span>
                </div>
              </div>

              <div
                v-if="testResult || openCodeState.lastError"
                class="rounded-md bg-slate-950/90 border border-slate-800 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2"
              >
                <span
                  v-if="testResult"
                  :class="testResult.ok ? 'text-emerald-300' : 'text-rose-300'"
                >
                  {{
                    testResult.ok
                      ? `Servidor accesible (${testResult.latencyMs} ms · ${testResult.sessionsCount} sesiones detectadas)`
                      : `Diagnóstico: ${testResult.error}`
                  }}
                </span>
                <span v-if="openCodeState.lastError" class="text-rose-300">
                  {{ openCodeState.lastError }}
                </span>
              </div>
            </div>

            <!-- Pestaña 2: Comando Bidireccional (Prompts + Sesiones + Interrupt) -->
            <div v-else-if="openCodeTab === 'command'" class="mt-3 space-y-3">
              <div
                v-if="openCodeState.status !== 'connected'"
                class="rounded-md bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300"
              >
                <span>Conecta primero con OpenCode para enviar instrucciones y crear sesiones.</span>
                <button
                  type="button"
                  @click="openCodeTab = 'connection'"
                  class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white cursor-pointer whitespace-nowrap"
                >
                  Ir a Conexión
                </button>
              </div>

              <form
                v-else
                @submit.prevent="handleSendOpenCodePrompt"
                class="space-y-2.5"
              >
                <div class="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                  <label class="md:col-span-5 flex flex-col gap-1 text-[11px] text-slate-400">
                    <span>Sesión OpenCode</span>
                    <div class="flex items-center gap-1.5">
                      <select
                        v-model="commandForm.sessionId"
                        class="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-sky-500"
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
                        class="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                      >
                        <Plus class="w-3.5 h-3.5" />
                        <span>{{ isCreatingSession ? "Creando..." : "Nueva sesión" }}</span>
                      </button>
                    </div>
                  </label>

                  <label class="md:col-span-4 flex flex-col gap-1 text-[11px] text-slate-400">
                    <span>Agente destinatario</span>
                    <select
                      v-model="commandForm.agent"
                      class="px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                    >
                      <option
                        v-for="ag in agentList"
                        :key="ag.id"
                        :value="ag.id"
                      >
                        {{ ag.name }} ({{ ag.id }})
                      </option>
                    </select>
                  </label>

                  <div class="md:col-span-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      :disabled="isInterrupting || !(commandForm.sessionId || openCodeState.activeSessionId)"
                      @click="handleInterruptOpenCode"
                      class="px-3 py-1.5 rounded-md bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-xs font-medium text-rose-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
                    >
                      <Square class="w-3 h-3 fill-current" />
                      <span>{{ isInterrupting ? "Deteniendo..." : "Detener" }}</span>
                    </button>
                  </div>
                </div>

                <div class="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                  <textarea
                    v-model="commandForm.prompt"
                    rows="2"
                    @keydown.ctrl.enter.prevent="handleSendOpenCodePrompt"
                    @keydown.meta.enter.prevent="handleSendOpenCodePrompt"
                    placeholder="Escribe una instrucción para OpenCode (Ctrl+Enter para enviar)..."
                    class="flex-1 px-3 py-2 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 resize-none"
                  ></textarea>

                  <button
                    type="submit"
                    :disabled="isSendingPrompt || !commandForm.prompt.trim()"
                    class="px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <Send class="w-3.5 h-3.5" />
                    <span>{{ isSendingPrompt ? "Enviando..." : "Enviar" }}</span>
                  </button>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span
                    v-if="commandFeedback"
                    :class="commandFeedback.ok ? 'text-emerald-300' : 'text-rose-300'"
                  >
                    {{ commandFeedback.text }}
                  </span>
                  <span v-else class="text-slate-400">
                    Las subtareas y herramientas aparecerán en los escritorios 3D y en el Tablero Kanban.
                  </span>
                  <span class="text-[11px] font-mono text-slate-500">
                    Rutas: {{ openCodeState.capabilities?.discoveredFrom || "v2" }}
                  </span>
                </div>
              </form>
            </div>

            <!-- Pestaña 3: Mapeo de los 5 Agentes -->
            <div v-else-if="openCodeTab === 'mapping'" class="mt-3 space-y-2.5">
              <div class="grid grid-cols-1 md:grid-cols-5 gap-2">
                <div
                  v-for="ag in agentList"
                  :key="ag.id"
                  class="rounded-md bg-slate-950/80 border border-slate-800 p-2.5 space-y-1.5"
                >
                  <div class="flex items-center justify-between gap-1.5">
                    <div class="flex items-center gap-1.5 min-w-0">
                      <span
                        class="w-2.5 h-2.5 rounded-sm shrink-0"
                        :style="{ backgroundColor: ag.color }"
                      ></span>
                      <span class="text-xs font-semibold text-slate-100 truncate">
                        {{ ag.name }}
                      </span>
                    </div>
                    <span
                      :class="[
                        'text-[10px] font-mono shrink-0',
                        openCodeState.activeAgents.includes(ag.id)
                          ? 'text-emerald-300'
                          : 'text-slate-500',
                      ]"
                    >
                      {{
                        openCodeState.activeAgents.includes(ag.id)
                          ? "En vivo"
                          : "Autónomo"
                      }}
                    </span>
                  </div>
                  <div class="text-[11px] font-mono text-slate-500">
                    ID: {{ ag.id }}
                  </div>
                  <input
                    v-model="aliasDraft[ag.id]"
                    type="text"
                    placeholder="alias1, alias2"
                    class="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div class="flex items-center justify-between gap-3">
                <span class="text-xs text-slate-400">
                  Resuelve eventos por <code class="text-slate-200">part.agent</code>, subagentes <code class="text-slate-200">task</code>, sesión hija <code class="text-slate-200">parentID</code> o alias separados por coma.
                </span>
                <div class="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    @click="handleSaveAliases"
                    class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Guardar alias
                  </button>
                  <button
                    type="button"
                    @click="handleResetAliases"
                    class="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Restaurar
                  </button>
                </div>
              </div>
            </div>

            <!-- Pestaña 3: Guía Paso a Paso y Plantilla opencode.json -->
            <div v-else class="mt-3 grid grid-cols-1 lg:grid-cols-12 gap-3">
              <div class="lg:col-span-6 space-y-2 text-xs text-slate-300">
                <p class="font-semibold text-slate-100">
                  Cómo conectar tu OpenCode paso a paso:
                </p>
                <ol class="space-y-1.5 list-decimal list-inside text-slate-300">
                  <li>
                    Copia el bloque <code class="text-sky-300">opencode.json</code> de la derecha en la raíz de tu proyecto o en <code class="text-slate-200">~/.config/opencode/opencode.json</code>.
                  </li>
                  <li>
                    Inicia el servidor local de OpenCode con CORS habilitado (o ejecuta el puente si accedes desde otro dominio).
                  </li>
                  <li>
                    Abre tu TUI conectado con <code class="text-sky-300">opencode attach</code> y usa <code class="text-slate-200">architect</code> para delegar en <code class="text-slate-200">@frontend</code>, <code class="text-slate-200">@backend</code>, <code class="text-slate-200">@qa</code> o <code class="text-slate-200">@systems</code>.
                  </li>
                  <li>
                    Pulsa <strong>Conectar</strong> en la pestaña Conexión; cada agente activo irá a su escritorio y los demás seguirán descansando.
                  </li>
                </ol>

                <div class="space-y-1.5 pt-1">
                  <div class="flex items-center justify-between gap-2 rounded bg-slate-950 border border-slate-800 px-2.5 py-1.5">
                    <code class="text-[11px] font-mono text-sky-300 truncate">
                      {{ OPENCODE_CLI_COMMANDS.serveDirect }}
                    </code>
                    <button
                      type="button"
                      @click="copySnippet('serve', OPENCODE_CLI_COMMANDS.serveDirect)"
                      class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Check v-if="copiedKey === 'serve'" class="w-3 h-3 text-emerald-400" />
                      <Copy v-else class="w-3 h-3" />
                      <span>{{ copiedKey === "serve" ? "Copiado" : "Copiar" }}</span>
                    </button>
                  </div>

                  <div class="flex items-center justify-between gap-2 rounded bg-slate-950 border border-slate-800 px-2.5 py-1.5">
                    <code class="text-[11px] font-mono text-slate-300 truncate">
                      {{ OPENCODE_CLI_COMMANDS.runBridge }} · {{ OPENCODE_CLI_COMMANDS.attachTui }}
                    </code>
                    <button
                      type="button"
                      @click="copySnippet('bridge', OPENCODE_CLI_COMMANDS.runBridge)"
                      class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Check v-if="copiedKey === 'bridge'" class="w-3 h-3 text-emerald-400" />
                      <Copy v-else class="w-3 h-3" />
                      <span>{{ copiedKey === "bridge" ? "Copiado" : "Puente" }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div class="lg:col-span-6 flex flex-col gap-1.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-xs font-medium text-slate-300">
                    Plantilla <code class="text-sky-300">opencode.json</code> (5 agentes)
                  </span>
                  <div class="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      @click="downloadOpenCodeReport"
                      class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download class="w-3.5 h-3.5" />
                      <span>Descargar guía (.md)</span>
                    </button>
                    <button
                      type="button"
                      @click="downloadOpenCodeJson"
                      class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download class="w-3.5 h-3.5" />
                      <span>Descargar .json</span>
                    </button>
                    <button
                      type="button"
                      @click="copySnippet('json', OPENCODE_JSON_SNIPPET)"
                      class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Check v-if="copiedKey === 'json'" class="w-3.5 h-3.5" />
                      <Copy v-else class="w-3.5 h-3.5" />
                      <span>{{ copiedKey === "json" ? "JSON copiado" : "Copiar JSON" }}</span>
                    </button>
                  </div>
                </div>
                <pre
                  class="rounded-md bg-slate-950 border border-slate-800 p-2.5 text-[11px] font-mono text-slate-300 overflow-auto max-h-44 leading-relaxed select-text"
                >{{ OPENCODE_JSON_SNIPPET }}</pre>
              </div>
            </div>
          </div>

          <!-- Panel Tablero de Tareas (Sprint) conectado a 3D -->
          <div
            v-if="isTaskBoardOpen"
            class="px-5 py-4 border-b border-slate-800 bg-slate-900/75 max-h-[38vh] overflow-y-auto"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-2.5 text-sm font-semibold text-slate-100">
                <ListTodo class="w-4 h-4 text-sky-400" />
                <span>Tablero de Tareas (Sprint)</span>
                <span aria-hidden="true" class="text-slate-600">·</span>
                <span class="text-xs font-normal text-slate-400 tabular-nums">
                  {{ tasks.length }} tareas
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <!-- Filtro rápido de origen -->
                <div
                  class="flex items-center gap-1 p-0.5 rounded-md bg-slate-950 border border-slate-800"
                >
                  <button
                    type="button"
                    @click="taskSourceFilter = 'all'"
                    :class="[
                      'px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      taskSourceFilter === 'all'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    @click="taskSourceFilter = 'opencode'"
                    :class="[
                      'px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      taskSourceFilter === 'opencode'
                        ? 'bg-slate-800 text-sky-300'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    OpenCode
                  </button>
                  <button
                    type="button"
                    @click="taskSourceFilter = 'manual'"
                    :class="[
                      'px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      taskSourceFilter === 'manual'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Manuales
                  </button>
                </div>

                <button
                  type="button"
                  :disabled="demoTasksCount === 0"
                  @click="handleClearDemoTasks"
                  class="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40"
                >
                  Limpiar demo
                </button>
                <button
                  type="button"
                  @click="taskBoardManager.clearDoneTasks()"
                  class="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Limpiar completadas
                </button>
                <button
                  type="button"
                  @click="taskBoardManager.resetTasks()"
                  class="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Restaurar demo
                </button>
                <button
                  type="button"
                  @click="isTaskBoardOpen = false"
                  aria-label="Cerrar tablero"
                  class="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Alta rápida de tarea -->
            <form
              @submit.prevent="handleCreateTask"
              class="mt-3 grid grid-cols-1 sm:grid-cols-12 gap-2"
            >
              <input
                v-model="newTask.title"
                type="text"
                maxlength="48"
                placeholder="Nueva tarea (ej. Optimizar sombras PBR)"
                class="sm:col-span-4 px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <input
                v-model="newTask.file"
                type="text"
                maxlength="42"
                placeholder="Archivo (ej. src/webgl/World.js)"
                class="sm:col-span-3 px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
              />
              <select
                v-model="newTask.assigneeId"
                class="sm:col-span-2 px-2 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                class="sm:col-span-2 px-2 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
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
                class="sm:col-span-1 px-2.5 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white flex items-center justify-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus class="w-3.5 h-3.5" />
                <span>Crear</span>
              </button>
            </form>

            <!-- Columnas Kanban -->
            <div class="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2.5">
              <div
                v-for="col in TASK_COLUMNS"
                :key="col.id"
                class="rounded-lg bg-slate-950/75 border border-slate-800/90 p-2.5 flex flex-col gap-2"
              >
                <div class="flex items-center justify-between text-xs font-semibold">
                  <span :class="col.accent">{{ col.label }}</span>
                  <span class="font-mono text-slate-500 tabular-nums">
                    {{ taskCountByStatus[col.id] }}
                  </span>
                </div>

                <div class="space-y-1.5">
                  <div
                    v-for="task in filteredTasks.filter((t) => t.status === col.id)"
                    :key="task.id"
                    class="rounded-md bg-slate-900 border border-slate-800 p-2 space-y-1.5"
                  >
                    <div class="flex items-start justify-between gap-1.5">
                      <p class="text-xs font-medium text-slate-100 leading-snug">
                        {{ task.title }}
                      </p>
                      <button
                        type="button"
                        @click="handleDeleteTask(task.id)"
                        aria-label="Eliminar tarea"
                        class="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 class="w-3 h-3" />
                      </button>
                    </div>
                    <div class="text-[11px] font-mono text-slate-400 truncate">
                      {{ task.file }}
                    </div>
                    <div class="flex items-center justify-between gap-1.5 pt-0.5">
                      <button
                        type="button"
                        @click="selectAgentFromDock(task.assigneeId)"
                        class="flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-white cursor-pointer truncate"
                      >
                        <span
                          class="w-2 h-2 rounded-sm shrink-0"
                          :style="{
                            backgroundColor:
                              profileMap[task.assigneeId]?.color || '#64748B',
                          }"
                        ></span>
                        <span class="truncate">{{
                          profileMap[task.assigneeId]?.name || task.assigneeId
                        }}</span>
                        <span
                          v-if="task.source === 'opencode'"
                          class="text-[10px] font-mono text-sky-400 shrink-0"
                        >
                          · OpenCode
                        </span>
                        <span
                          v-else-if="task.source === 'demo'"
                          class="text-[10px] text-slate-500 shrink-0"
                        >
                          · Demo
                        </span>
                      </button>

                      <select
                        :value="task.status"
                        @change="handleMoveTask(task.id, $event.target.value)"
                        aria-label="Cambiar estado de tarea"
                        class="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] text-slate-300 focus:outline-none focus:border-sky-500 cursor-pointer"
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

          <!-- Panel Inspector & Debug HUD del agente seleccionado -->
          <div
            v-if="selectedSnapshot"
            class="px-5 py-4 border-b border-slate-800 bg-slate-900/55"
          >
            <!-- Cabecera del agente seleccionado -->
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3 min-w-0">
                <span
                  class="w-3 h-3 rounded-sm shrink-0"
                  :style="{ backgroundColor: selectedSnapshot.color }"
                ></span>
                <div class="min-w-0">
                  <div class="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <span class="truncate">{{ selectedSnapshot.name }}</span>
                    <span aria-hidden="true" class="text-slate-600">·</span>
                    <span class="text-xs font-normal text-slate-400 truncate">{{
                      selectedSnapshot.role
                    }}</span>
                  </div>
                  <div
                    class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-slate-400 font-mono tabular-nums"
                  >
                    <span class="text-slate-200">{{
                      selectedSnapshot.state
                    }}</span>
                    <span aria-hidden="true" class="text-slate-600">·</span>
                    <span>Zona: {{ selectedSnapshot.zone }}</span>
                    <span aria-hidden="true" class="text-slate-600">·</span>
                    <span>Clip: {{ selectedSnapshot.animation }}</span>
                    <span aria-hidden="true" class="text-slate-600">·</span>
                    <span>Prop: {{ selectedSnapshot.prop }}</span>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <!-- Selector de pestaña de Debug -->
                <div
                  class="flex items-center gap-1 p-0.5 rounded-md bg-slate-900 border border-slate-800"
                >
                  <button
                    type="button"
                    @click="activeInspectorTab = 'routes'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      activeInspectorTab === 'routes'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Recorridos (5 Zonas)
                  </button>
                  <button
                    type="button"
                    @click="activeInspectorTab = 'animations'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                      activeInspectorTab === 'animations'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    Animaciones y Props
                  </button>
                  <button
                    type="button"
                    @click="activeInspectorTab = 'events'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1',
                      activeInspectorTab === 'events'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    <Radio class="w-3 h-3" />
                    <span>Event Bus</span>
                  </button>
                  <button
                    type="button"
                    @click="activeInspectorTab = 'profile'"
                    :class="[
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1',
                      activeInspectorTab === 'profile'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200',
                    ]"
                  >
                    <UserCog class="w-3 h-3" />
                    <span>Perfil</span>
                  </button>
                </div>

                <button
                  type="button"
                  @click="experience?.focusAgent(selectedSnapshot.id)"
                  class="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Crosshair class="w-3.5 h-3.5" />
                  <span>Enfocar</span>
                </button>

                <button
                  type="button"
                  @click="experience?.handleStationSelect(null)"
                  aria-label="Cerrar inspector"
                  class="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Disparadores manuales de prueba -->
            <div
              v-if="activeInspectorTab === 'routes'"
              class="mt-3 flex flex-wrap items-center gap-1.5"
            >
              <button
                v-for="trigger in ROUTE_TRIGGERS"
                :key="trigger.checkpointId"
                type="button"
                @click="sendToRoute(trigger)"
                class="px-2.5 py-1.5 rounded-md bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {{ trigger.label }}
              </button>
              <button
                type="button"
                @click="sendSelectedHome"
                class="px-2.5 py-1.5 rounded-md bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-xs font-medium text-sky-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Volver al Escritorio
              </button>
            </div>

            <div
              v-else-if="activeInspectorTab === 'animations'"
              class="mt-3 flex flex-wrap items-center gap-1.5"
            >
              <button
                v-for="anim in ANIMATION_TRIGGERS"
                :key="anim.action"
                type="button"
                @click="triggerAnimationPreview(anim.action)"
                :class="[
                  'px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  selectedSnapshot.animation === anim.action
                    ? 'bg-sky-600/25 border-sky-500/50 text-sky-200'
                    : 'bg-slate-800/90 hover:bg-slate-700 border-slate-700/70 text-slate-200',
                ]"
              >
                {{ anim.label }}
              </button>
            </div>

            <div v-else-if="activeInspectorTab === 'events'" class="mt-3 space-y-2.5">
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  v-for="item in BUS_TEST_ACTIONS"
                  :key="item.label"
                  type="button"
                  @click="triggerBusTest(item)"
                  class="px-2.5 py-1.5 rounded-md bg-slate-800/90 hover:bg-slate-700 border border-slate-700/70 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {{ item.label }}
                </button>
              </div>
              <div
                v-if="eventLog.length > 0"
                class="rounded-md bg-slate-950/85 border border-slate-800 px-3 py-2 space-y-1 max-h-24 overflow-y-auto font-mono text-[11px] text-slate-400"
              >
                <div
                  v-for="ev in eventLog"
                  :key="ev.id"
                  class="flex items-center justify-between gap-3 truncate"
                >
                  <span class="text-sky-300 shrink-0">{{ ev.type }}</span>
                  <span class="truncate text-slate-300">
                    {{
                      ev.payload.label ||
                      ev.payload.topic ||
                      ev.payload.venue ||
                      ev.payload.mode ||
                      ev.payload.agentId ||
                      ""
                    }}
                  </span>
                  <span class="text-slate-500 shrink-0">{{ ev.source }}</span>
                </div>
              </div>
            </div>

            <!-- Pestaña Perfil: personalización en vivo del agente -->
            <form
              v-else
              @submit.prevent="handleSaveProfile"
              class="mt-3 flex flex-wrap items-end justify-between gap-3"
            >
              <div class="flex flex-wrap items-end gap-2.5 flex-1 min-w-[260px]">
                <label class="flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Nombre</span>
                  <input
                    v-model="profileDraft.name"
                    type="text"
                    maxlength="20"
                    class="w-36 px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>

                <label class="flex flex-col gap-1 text-[11px] text-slate-400">
                  <span>Especialidad / Rol</span>
                  <input
                    v-model="profileDraft.role"
                    type="text"
                    maxlength="28"
                    class="w-48 px-2.5 py-1.5 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-sky-500"
                  />
                </label>

                <div class="flex flex-col gap-1 text-[11px] text-slate-400">
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
                        'w-5 h-5 rounded-sm transition-transform cursor-pointer border',
                        profileDraft.color === swatch.hex
                          ? 'scale-110 border-white'
                          : 'border-slate-700 opacity-80 hover:opacity-100',
                      ]"
                      :style="{ backgroundColor: swatch.hex }"
                    ></button>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  class="px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Aplicar cambios
                </button>
                <button
                  type="button"
                  @click="handleResetProfiles"
                  class="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Restaurar equipo
                </button>
              </div>
            </form>
          </div>

          <!-- Fila principal de controles globales -->
          <div
            class="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
          >
            <!-- Selector rápido de agentes -->
            <div class="flex items-center gap-1.5 overflow-x-auto">
              <button
                v-for="agent in agentList"
                :key="agent.id"
                type="button"
                @click="selectAgentFromDock(agent.id)"
                :class="[
                  'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 whitespace-nowrap shrink-0 border',
                  selectedAgentId === agent.id
                    ? 'bg-slate-800 text-white border-slate-600'
                    : 'bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800/70 border-slate-800',
                ]"
              >
                <span
                  class="w-2 h-2 rounded-sm shrink-0"
                  :style="{ backgroundColor: agent.color }"
                ></span>
                <span>{{ agent.name }}</span>
                <span
                  v-if="openCodeState.activeAgents.includes(agent.id)"
                  class="text-[10px] font-mono text-emerald-300"
                >
                  · vivo
                </span>
              </button>
            </div>

            <!-- Controles de Mock Director + OpenCode + Tablero + Ambiente -->
            <div class="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
              <!-- OpenCode CLI (prioritario) -->
              <button
                type="button"
                @click="toggleOpenCodePanel"
                :class="[
                  'px-2.5 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  isOpenCodePanelOpen || openCodeState.status === 'connected'
                    ? 'bg-sky-600/20 border-sky-500/40 text-sky-200'
                    : openCodeState.status === 'error'
                      ? 'bg-rose-600/20 border-rose-500/40 text-rose-200'
                      : 'bg-slate-900 border-slate-700 text-slate-100 hover:bg-slate-800',
                ]"
              >
                <Terminal class="w-3.5 h-3.5 text-sky-400" />
                <span>OpenCode</span>
                <span
                  v-if="openCodeState.status === 'connected'"
                  class="font-mono text-[11px] text-emerald-300 tabular-nums"
                >
                  {{ openCodeState.activeAgents.length }}/5
                </span>
              </button>

              <!-- Tablero de Tareas -->
              <button
                type="button"
                @click="toggleTaskBoard"
                :class="[
                  'px-2.5 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  isTaskBoardOpen
                    ? 'bg-sky-600/20 border-sky-500/40 text-sky-200'
                    : 'bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-800',
                ]"
              >
                <ListTodo class="w-3.5 h-3.5" />
                <span>Tablero</span>
                <span class="font-mono text-[11px] text-slate-400 tabular-nums">
                  {{ tasks.length }}
                </span>
              </button>

              <!-- Mock Director -->
              <div
                class="flex items-center gap-1 p-0.5 rounded-md bg-slate-900 border border-slate-800"
              >
                <button
                  type="button"
                  @click="toggleDirectorPause"
                  class="px-2.5 py-1 rounded text-xs font-medium text-slate-200 hover:bg-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Play v-if="directorState.paused" class="w-3.5 h-3.5" />
                  <Pause v-else class="w-3.5 h-3.5" />
                  <span>{{ directorState.paused ? "Reanudar" : "Pausar" }}</span>
                </button>
                <button
                  type="button"
                  @click="toggleDirectorSpeed"
                  class="px-2 py-1 rounded text-xs font-mono tabular-nums text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {{ directorState.speedMultiplier }}x
                </button>
              </div>

              <!-- Eventos Grupales y Sociales -->
              <button
                type="button"
                @click="experience?.triggerPairChat()"
                class="px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageSquare class="w-3.5 h-3.5" />
                <span>Charla</span>
              </button>

              <button
                type="button"
                @click="experience?.triggerDeskReview()"
                class="px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <GitPullRequest class="w-3.5 h-3.5" />
                <span>Revisión</span>
              </button>

              <button
                type="button"
                @click="experience?.triggerPingPongMatch()"
                class="px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Gamepad2 class="w-3.5 h-3.5" />
                <span>Ping-Pong</span>
              </button>

              <button
                type="button"
                @click="experience?.triggerTeamMeeting()"
                class="px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Users class="w-3.5 h-3.5" />
                <span>Reunión</span>
              </button>

              <!-- Visibilidad Burbujas 3D -->
              <button
                type="button"
                @click="toggleBubbles"
                :class="[
                  'px-2.5 py-1.5 rounded-md border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0',
                  showBubbles
                    ? 'bg-sky-600/20 border-sky-500/40 text-sky-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200',
                ]"
              >
                <MessageSquare class="w-3.5 h-3.5" />
                <span>Burbujas</span>
              </button>

              <!-- Audio Ambiental Web Audio -->
              <div
                class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 border border-slate-800"
              >
                <button
                  type="button"
                  @click="toggleAudio"
                  :class="[
                    'text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0',
                    audioEnabled ? 'text-sky-300' : 'text-slate-400 hover:text-slate-200',
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
                  class="w-14 accent-sky-500 cursor-pointer"
                />
              </div>

              <!-- Iluminación -->
              <div
                class="flex items-center gap-1 p-0.5 rounded-md bg-slate-900 border border-slate-800"
              >
                <button
                  type="button"
                  @click="setLightingMode('day')"
                  :class="[
                    'px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
                    timeMode === 'day'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200',
                  ]"
                >
                  <Sun class="w-3.5 h-3.5" />
                  <span>Día</span>
                </button>
                <button
                  type="button"
                  @click="setLightingMode('night')"
                  :class="[
                    'px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
                    timeMode === 'night'
                      ? 'bg-indigo-500/20 text-indigo-300'
                      : 'text-slate-400 hover:text-slate-200',
                  ]"
                >
                  <Moon class="w-3.5 h-3.5" />
                  <span>Noche</span>
                </button>
                <button
                  type="button"
                  @click="setLightingMode('auto')"
                  :class="[
                    'px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap',
                    timeMode === 'auto'
                      ? 'bg-sky-500/20 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200',
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
                class="px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw class="w-3.5 h-3.5" />
                <span>Vista General</span>
              </button>
            </div>
          </div>
        </div>
      </transition>
    </section>
  </main>
</template>
