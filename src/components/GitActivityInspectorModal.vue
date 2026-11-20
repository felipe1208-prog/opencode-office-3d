<script setup>
import { ref, computed, watch } from "vue";
import {
  X,
  RefreshCw,
  GitBranch,
  GitCommitHorizontal,
  Terminal,
  FileCode2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Send,
  ChevronDown,
  ChevronUp,
} from "@lucide/vue";
import { openCodeBridge } from "../opencode/OpenCodeBridgeClient";

const props = defineProps({
  open: { type: Boolean, default: false },
  initialTab: { type: String, default: "git" }, // 'git' | 'activity'
  initialAgentId: { type: String, default: "all" },
  profiles: { type: Array, default: () => [] },
  workspace: { type: Object, default: null },
  toolActivity: { type: Array, default: () => [] },
  isConnected: { type: Boolean, default: false },
});

const emit = defineEmits([
  "close",
  "refresh-workspace",
  "open-settings",
  "dispatch-prompt",
]);

const activeTab = ref(props.initialTab || "git");
const gitSubTab = ref("changes"); // 'changes' | 'commits'
const selectedAgentFilter = ref(props.initialAgentId || "all");
const onlyErrorsFilter = ref(false);

const selectedFilePath = ref(null);
const selectedCommitHash = ref(null);
const commitsList = ref([]);
const commitsLoading = ref(false);
const commitsError = ref(null);

const diffState = ref({
  loading: false,
  error: null,
  diff: "",
  truncated: false,
  untracked: false,
  title: "",
});
const isRefreshing = ref(false);
const expandedOutputIds = ref(new Set());
const copiedId = ref(null);
const actionFeedback = ref(null);
const fixTargetAgent = ref("frontend");

const profileMap = computed(() =>
  Object.fromEntries((props.profiles || []).map((p) => [p.id, p])),
);

const changes = computed(() =>
  Array.isArray(props.workspace?.changes) ? props.workspace.changes : [],
);

const allActivity = computed(() =>
  Array.isArray(props.toolActivity) ? props.toolActivity : [],
);

const errorCount = computed(
  () => allActivity.value.filter((item) => item.status === "error").length,
);

const filteredActivity = computed(() => {
  let list = allActivity.value;
  if (selectedAgentFilter.value !== "all") {
    list = list.filter((item) => item.agentId === selectedAgentFilter.value);
  }
  if (onlyErrorsFilter.value) {
    list = list.filter((item) => item.status === "error");
  }
  return list;
});

const parsedDiffLines = computed(() => {
  const raw = String(diffState.value.diff || "");
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line, index) => {
    let type = "context";
    if (
      line.startsWith("+++") ||
      line.startsWith("---") ||
      line.startsWith("diff ") ||
      line.startsWith("commit ") ||
      line.startsWith("Author:") ||
      line.startsWith("Date:")
    ) {
      type = "meta";
    } else if (line.startsWith("@@")) {
      type = "hunk";
    } else if (line.startsWith("+")) {
      type = "add";
    } else if (line.startsWith("-")) {
      type = "del";
    }
    return { index, line, type };
  });
});

watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) return;
    activeTab.value = props.initialTab || "git";
    selectedAgentFilter.value = props.initialAgentId || "all";
    actionFeedback.value = null;
    if (props.initialAgentId && props.initialAgentId !== "all") {
      fixTargetAgent.value = props.initialAgentId;
    }
    await handleRefresh();
    if (gitSubTab.value === "changes") {
      if (changes.value.length > 0) {
        const stillExists = changes.value.some((c) => c.path === selectedFilePath.value);
        if (!stillExists) {
          await selectFile(changes.value[0].path);
        }
      } else {
        selectedFilePath.value = null;
        if (commitsList.value.length > 0) {
          gitSubTab.value = "commits";
          await selectCommit(commitsList.value[0].hash);
        } else {
          resetDiffState();
        }
      }
    }
  },
);

watch(
  () => props.initialAgentId,
  (nextId) => {
    if (props.open && nextId) {
      selectedAgentFilter.value = nextId;
      if (nextId !== "all") {
        fixTargetAgent.value = nextId;
      }
    }
  },
);

function resetDiffState() {
  diffState.value = {
    loading: false,
    error: null,
    diff: "",
    truncated: false,
    untracked: false,
    title: "",
  };
}

async function loadCommits() {
  commitsLoading.value = true;
  commitsError.value = null;
  const res = await openCodeBridge.fetchWorkspaceLog(20);
  if (res?.ok) {
    commitsList.value = Array.isArray(res.commits) ? res.commits : [];
  } else {
    commitsList.value = [];
    commitsError.value = res?.error || null;
  }
  commitsLoading.value = false;
}

async function handleRefresh() {
  isRefreshing.value = true;
  emit("refresh-workspace");
  await Promise.all([
    openCodeBridge.fetchWorkspaceSummary(),
    loadCommits(),
  ]);
  if (gitSubTab.value === "changes" && selectedFilePath.value) {
    await selectFile(selectedFilePath.value);
  } else if (gitSubTab.value === "commits" && selectedCommitHash.value) {
    await selectCommit(selectedCommitHash.value);
  }
  isRefreshing.value = false;
}

async function switchGitSubTab(tab) {
  gitSubTab.value = tab;
  if (tab === "changes") {
    selectedCommitHash.value = null;
    if (selectedFilePath.value && changes.value.some((c) => c.path === selectedFilePath.value)) {
      await selectFile(selectedFilePath.value);
    } else if (changes.value.length > 0) {
      await selectFile(changes.value[0].path);
    } else {
      selectedFilePath.value = null;
      resetDiffState();
    }
  } else {
    selectedFilePath.value = null;
    if (commitsList.value.length === 0) {
      await loadCommits();
    }
    if (commitsList.value.length > 0) {
      await selectCommit(commitsList.value[0].hash);
    } else {
      selectedCommitHash.value = null;
      resetDiffState();
    }
  }
}

async function selectFile(filePath) {
  if (!filePath) return;
  selectedFilePath.value = filePath;
  selectedCommitHash.value = null;
  diffState.value = {
    loading: true,
    error: null,
    diff: "",
    truncated: false,
    untracked: false,
    title: filePath,
  };
  const res = await openCodeBridge.fetchWorkspaceDiff(filePath);
  if (res.ok) {
    diffState.value = {
      loading: false,
      error: null,
      diff: res.diff || "",
      truncated: Boolean(res.truncated),
      untracked: Boolean(res.isUntracked || res.untracked),
      title: filePath,
    };
  } else {
    diffState.value = {
      loading: false,
      error: res.error || "No se pudo obtener el diff del archivo.",
      diff: "",
      truncated: false,
      untracked: false,
      title: filePath,
    };
  }
}

async function selectCommit(hash) {
  if (!hash) return;
  selectedCommitHash.value = hash;
  selectedFilePath.value = null;
  const meta = commitsList.value.find((c) => c.hash === hash);
  const title = meta ? `${meta.shortHash} · ${meta.subject}` : hash.slice(0, 8);
  diffState.value = {
    loading: true,
    error: null,
    diff: "",
    truncated: false,
    untracked: false,
    title,
  };
  const res = await openCodeBridge.fetchWorkspaceCommitDetail(hash);
  if (res.ok) {
    diffState.value = {
      loading: false,
      error: null,
      diff: res.diff || "",
      truncated: Boolean(res.truncated),
      untracked: false,
      title,
    };
  } else {
    diffState.value = {
      loading: false,
      error: res.error || "No se pudo inspeccionar el commit.",
      diff: "",
      truncated: false,
      untracked: false,
      title,
    };
  }
}

function resolveChangeStatus(item) {
  if (!item) return "modified";
  if (item.status) return item.status;
  if (item.isUntracked || item.code === "??") return "untracked";
  if (String(item.code || "").includes("D")) return "deleted";
  if (String(item.code || "").includes("R")) return "renamed";
  if (String(item.code || "").includes("A")) return "added";
  return "modified";
}

function statusBadgeLabel(item) {
  const status = resolveChangeStatus(item);
  if (status === "added" || status === "untracked") return "N";
  if (status === "deleted") return "E";
  if (status === "renamed") return "R";
  return "M";
}

function statusBadgeClass(item) {
  const status = resolveChangeStatus(item);
  if (status === "added" || status === "untracked") return "text-[#34D399]";
  if (status === "deleted") return "text-[#FB7185]";
  if (status === "renamed") return "text-[#7DD3FC]";
  return "text-[#FBBF24]";
}

function getCombinedToolOutput(ev) {
  const parts = [];
  const err = String(ev?.errorMessage || ev?.error || "").trim();
  const out = String(ev?.fullOutput || ev?.output || ev?.outputExcerpt || "").trim();
  if (err) parts.push(err);
  if (out && (!err || !err.includes(out))) parts.push(out);
  return parts.join("\n\n").trim();
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function isOutputExpanded(ev) {
  const key = ev.id || ev.callKey || ev.callId;
  if (expandedOutputIds.value.has(key)) return true;
  // Expandir por defecto los errores para inspección inmediata
  return ev.status === "error" && !expandedOutputIds.value.has(`collapsed:${key}`);
}

function toggleOutputExpanded(ev) {
  const key = ev.id || ev.callKey || ev.callId;
  const next = new Set(expandedOutputIds.value);
  if (isOutputExpanded(ev)) {
    next.delete(key);
    if (ev.status === "error") next.add(`collapsed:${key}`);
  } else {
    next.delete(`collapsed:${key}`);
    next.add(key);
  }
  expandedOutputIds.value = next;
}

async function copyText(id, text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copiedId.value = id;
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = null;
    }, 1500);
  } catch {
    // Sin permisos de portapapeles
  }
}

function requestQaReviewForCurrentDiff() {
  const target = selectedFilePath.value || selectedCommitHash.value;
  if (!target) return;
  const isCommit = Boolean(selectedCommitHash.value && !selectedFilePath.value);
  const prompt = isCommit
    ? `Revisa el commit ${selectedCommitHash.value.slice(0, 8)} (${diffState.value.title}). Verifica calidad, posibles regresiones y casos límite; si detectas algún fallo, coordina el ajuste con el especialista responsable.`
    : `Revisa los cambios actuales en \`${selectedFilePath.value}\`. Analiza el diff, posibles regresiones, validación de errores y pruebas necesarias; si encuentras algo por corregir, solicita el ajuste al especialista correspondiente.`;
  emit("dispatch-prompt", {
    agentId: "qa",
    prompt,
    openChat: true,
  });
  actionFeedback.value = "Revisión enviada a DevOps / QA";
}

function requestFixForCurrentDiff() {
  const target = selectedFilePath.value;
  if (!target) return;
  const agentId = fixTargetAgent.value || "architect";
  const agentName = profileMap.value[agentId]?.name || agentId;
  const prompt = `Revisa y corrige los cambios actuales en \`${target}\`. Verifica que compile sin errores y que no queden casos rotos ni código residual; al terminar, pide revisión a @qa.`;
  emit("dispatch-prompt", {
    agentId,
    prompt,
    openChat: true,
  });
  actionFeedback.value = `Solicitud enviada a ${agentName}`;
}

function requestFixForFailedTool(ev) {
  const agentId = ev.agentId || "architect";
  const cmd = ev.command || ev.target || ev.toolName || "comando";
  const out = getCombinedToolOutput(ev).slice(0, 1800);
  const prompt = `Falló la ejecución de \`${cmd}\`:\n\n\`\`\`\n${out || "Error sin salida detallada"}\n\`\`\`\n\nAnaliza la causa raíz, corrígelo y vuelve a ejecutar la verificación para confirmar que pase limpio.`;
  emit("dispatch-prompt", {
    agentId,
    prompt,
    openChat: true,
  });
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatCommitDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
</script>

<template>
  <transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-120 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="open"
      @click.self="emit('close')"
      class="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
    >
      <div
        class="w-[min(960px,96vw)] h-[min(84vh,700px)] hud-glass-elevated rounded-2xl flex flex-col overflow-hidden"
      >
        <!-- Cabecera limpia -->
        <div
          class="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0"
        >
          <div class="flex items-center gap-3 min-w-0">
            <GitBranch class="w-4 h-4 text-[#E09F5A] shrink-0" />
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-[#F6EFE6] truncate">
                Inspector de Repositorio y Actividad
              </h2>
              <div class="text-[11px] text-[#B5AEA4] truncate tabular-nums">
                <template v-if="workspace?.projectName">
                  {{ workspace.projectName }}
                  <template v-if="workspace.isGitRepo">
                    · rama {{ workspace.branch || "HEAD" }} · {{ changes.length }} cambios · {{ commitsList.length }} commits
                  </template>
                  <template v-else>· sin repositorio Git</template>
                </template>
                <template v-else>
                  Conectado mediante puente local (:4097)
                </template>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              @click="handleRefresh"
              :disabled="isRefreshing"
              title="Actualizar estado Git y commits"
              class="px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/[0.08] text-xs font-medium text-[#EAE4DC] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw
                :class="['w-3.5 h-3.5 text-[#E09F5A]', isRefreshing ? 'animate-spin' : '']"
              />
              <span>Actualizar</span>
            </button>
            <button
              type="button"
              @click="emit('close')"
              aria-label="Cerrar inspector"
              class="p-1.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Tabs principales -->
        <div class="px-5 pt-3 pb-2 shrink-0 flex flex-wrap items-center justify-between gap-2">
          <div
            class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/25 border border-white/[0.08] w-[min(340px,100%)]"
          >
            <button
              type="button"
              @click="activeTab = 'git'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap',
                activeTab === 'git'
                  ? 'bg-white/[0.1] text-[#FFFDF9]'
                  : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
              ]"
            >
              <FileCode2 class="w-3.5 h-3.5" />
              <span>Repositorio Git</span>
              <span v-if="changes.length > 0" class="tabular-nums text-[11px] text-[#E09F5A]">
                {{ changes.length }}
              </span>
            </button>
            <button
              type="button"
              @click="activeTab = 'activity'"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap',
                activeTab === 'activity'
                  ? 'bg-white/[0.1] text-[#FFFDF9]'
                  : 'text-[#B5AEA4] hover:text-[#F3EFE8]',
              ]"
            >
              <Terminal class="w-3.5 h-3.5" />
              <span>Actividad Técnica</span>
              <span v-if="errorCount > 0" class="tabular-nums text-[11px] text-[#FB7185]">
                {{ errorCount }}
              </span>
            </button>
          </div>

          <button
            v-if="activeTab === 'git'"
            type="button"
            @click="emit('open-settings', 'workspace')"
            class="text-[11px] text-[#C8C0B5] hover:text-[#FFFDF9] underline decoration-white/20 underline-offset-2 cursor-pointer whitespace-nowrap"
          >
            Cambiar carpeta del proyecto
          </button>
        </div>

        <!-- TAB 1: REPOSITORIO GIT (Cambios + Commits) -->
        <div
          v-if="activeTab === 'git'"
          class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[290px_1fr] border-t border-white/[0.08]"
        >
          <!-- Columna izquierda: selector Cambios / Commits + lista -->
          <div class="border-b md:border-b-0 md:border-r border-white/[0.08] flex flex-col min-h-0">
            <div class="p-2.5 border-b border-white/[0.07] shrink-0">
              <div class="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-black/25 border border-white/[0.07]">
                <button
                  type="button"
                  @click="switchGitSubTab('changes')"
                  :class="[
                    'px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1',
                    gitSubTab === 'changes'
                      ? 'bg-white/[0.1] text-[#FFFDF9]'
                      : 'text-[#A39B90] hover:text-[#EAE4DC]',
                  ]"
                >
                  <span>Cambios</span>
                  <span class="tabular-nums text-[10px] text-[#E09F5A]">{{ changes.length }}</span>
                </button>
                <button
                  type="button"
                  @click="switchGitSubTab('commits')"
                  :class="[
                    'px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer flex items-center justify-center gap-1',
                    gitSubTab === 'commits'
                      ? 'bg-white/[0.1] text-[#FFFDF9]'
                      : 'text-[#A39B90] hover:text-[#EAE4DC]',
                  ]"
                >
                  <GitCommitHorizontal class="w-3 h-3" />
                  <span>Commits</span>
                  <span class="tabular-nums text-[10px] text-[#B5AEA4]">{{ commitsList.length }}</span>
                </button>
              </div>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-1">
              <div
                v-if="!workspace?.ok"
                class="p-3 rounded-xl bg-black/20 border border-white/[0.06] text-xs text-[#C8C0B5] space-y-2"
              >
                <p>
                  Inicia el puente local (<span class="font-mono text-[#F6C894]">npm run opencode:bridge</span>) para inspeccionar el repositorio en tiempo real.
                </p>
              </div>

              <div
                v-else-if="!workspace.isGitRepo"
                class="p-3 rounded-xl bg-black/20 border border-white/[0.06] text-xs text-[#C8C0B5]"
              >
                La carpeta actual no es un repositorio Git. Puedes seleccionar otra carpeta desde Ajustes.
              </div>

              <!-- Sublista: Cambios -->
              <template v-else-if="gitSubTab === 'changes'">
                <div
                  v-if="changes.length === 0"
                  class="p-4 text-center text-xs text-[#A39B90] space-y-1"
                >
                  <CheckCircle2 class="w-5 h-5 text-[#34D399] mx-auto" />
                  <p class="font-medium text-[#E7E1D8]">Árbol de trabajo limpio</p>
                  <p>No hay archivos modificados en {{ workspace.branch || "esta rama" }}.</p>
                </div>

                <button
                  v-for="item in changes"
                  :key="item.path"
                  type="button"
                  @click="selectFile(item.path)"
                  :class="[
                    'w-full text-left px-2.5 py-2 rounded-xl border text-xs transition-colors cursor-pointer flex items-center justify-between gap-2',
                    selectedFilePath === item.path
                      ? 'bg-[#E09F5A]/18 border-[#E09F5A]/45 text-[#FFFDF9]'
                      : 'bg-white/[0.02] border-transparent hover:bg-white/[0.06] text-[#DDD6CD]',
                  ]"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      :class="['font-mono text-[11px] font-semibold w-3 shrink-0', statusBadgeClass(item)]"
                    >
                      {{ statusBadgeLabel(item) }}
                    </span>
                    <span class="truncate font-mono text-[11px]" :title="item.path">
                      {{ item.path }}
                    </span>
                  </div>
                  <span
                    v-if="item.insertions > 0 || item.deletions > 0"
                    class="text-[10px] font-mono tabular-nums shrink-0 flex items-center gap-1"
                  >
                    <span v-if="item.insertions > 0" class="text-[#34D399]">+{{ item.insertions }}</span>
                    <span v-if="item.deletions > 0" class="text-[#FB7185]">-{{ item.deletions }}</span>
                  </span>
                </button>
              </template>

              <!-- Sublista: Commits recientes (git log) -->
              <template v-else>
                <div v-if="commitsLoading" class="p-3 text-xs text-[#A39B90]">
                  Cargando historial de commits...
                </div>
                <div v-else-if="commitsError" class="p-3 text-xs text-[#FDA4AF]">
                  {{ commitsError }}
                </div>
                <div
                  v-else-if="commitsList.length === 0"
                  class="p-4 text-center text-xs text-[#A39B90]"
                >
                  Aún no hay commits registrados en esta rama.
                </div>
                <button
                  v-for="commit in commitsList"
                  :key="commit.hash"
                  type="button"
                  @click="selectCommit(commit.hash)"
                  :class="[
                    'w-full text-left px-2.5 py-2 rounded-xl border text-xs transition-colors cursor-pointer space-y-1',
                    selectedCommitHash === commit.hash
                      ? 'bg-[#E09F5A]/18 border-[#E09F5A]/45 text-[#FFFDF9]'
                      : 'bg-white/[0.02] border-transparent hover:bg-white/[0.06] text-[#DDD6CD]',
                  ]"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-mono text-[11px] text-[#F6C894] font-semibold">
                      {{ commit.shortHash }}
                    </span>
                    <span class="text-[10px] text-[#A39B90] tabular-nums truncate">
                      {{ formatCommitDate(commit.date) }}
                    </span>
                  </div>
                  <div class="text-[11px] text-[#F3EFE8] leading-snug line-clamp-2">
                    {{ commit.subject }}
                  </div>
                  <div class="text-[10px] text-[#A39B90] truncate">
                    {{ commit.author }}
                  </div>
                </button>
              </template>
            </div>
          </div>

          <!-- Visor de Diff / Commit + Acciones rápidas -->
          <div class="min-h-0 flex flex-col bg-black/20">
            <div
              v-if="selectedFilePath || selectedCommitHash"
              class="px-4 py-2 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#C8C0B5] shrink-0"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="font-mono truncate select-text text-[#F3EFE8]">
                  {{ diffState.title || selectedFilePath || selectedCommitHash }}
                </span>
                <span v-if="diffState.untracked" class="text-[#34D399] shrink-0">
                  · Nuevo
                </span>
                <span v-else-if="diffState.truncated" class="text-[#FBBF24] shrink-0">
                  · Truncado 64 KB
                </span>
              </div>

              <!-- Acciones rápidas sobre el archivo o commit actual -->
              <div v-if="isConnected" class="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  @click="requestQaReviewForCurrentDiff"
                  class="px-2 py-1 rounded-lg bg-[#22C55E]/15 hover:bg-[#22C55E]/25 border border-[#22C55E]/35 text-[11px] font-medium text-[#BBF7D0] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Send class="w-3 h-3" />
                  <span>Pedir revisión a QA</span>
                </button>
                <template v-if="selectedFilePath">
                  <select
                    v-model="fixTargetAgent"
                    aria-label="Especialista para ajuste"
                    class="px-1.5 py-1 rounded-lg bg-black/35 border border-white/[0.1] text-[11px] text-[#EAE4DC] focus:outline-none focus:border-[#E09F5A]/60"
                  >
                    <option
                      v-for="ag in profiles"
                      :key="ag.id"
                      :value="ag.id"
                      class="bg-[#1B1714] text-[#F3EFE8]"
                    >
                      {{ ag.name }}
                    </option>
                  </select>
                  <button
                    type="button"
                    @click="requestFixForCurrentDiff"
                    class="px-2 py-1 rounded-lg bg-[#E09F5A]/18 hover:bg-[#E09F5A]/28 border border-[#E09F5A]/40 text-[11px] font-medium text-[#F6C894] cursor-pointer whitespace-nowrap"
                  >
                    Pedir ajuste
                  </button>
                </template>
              </div>
            </div>

            <div
              v-if="actionFeedback"
              class="px-4 py-1.5 bg-[#E09F5A]/14 border-b border-[#E09F5A]/25 text-[11px] text-[#F6C894] shrink-0"
            >
              {{ actionFeedback }}
            </div>

            <div class="flex-1 min-h-0 overflow-auto p-3 font-mono text-[11px] leading-relaxed select-text">
              <div v-if="diffState.loading" class="text-[#A39B90] p-2">
                Cargando diff...
              </div>
              <div v-else-if="diffState.error" class="text-[#FDA4AF] p-2">
                {{ diffState.error }}
              </div>
              <div
                v-else-if="!selectedFilePath && !selectedCommitHash"
                class="text-[#8C847A] p-4 text-center font-sans text-xs"
              >
                Selecciona un archivo modificado o un commit para inspeccionar sus cambios.
              </div>
              <div v-else-if="parsedDiffLines.length === 0" class="text-[#A39B90] p-2 font-sans text-xs">
                Sin diferencias textuales para mostrar.
              </div>
              <div v-else class="space-y-0.5">
                <div
                  v-for="row in parsedDiffLines"
                  :key="row.index"
                  :class="[
                    'px-2 py-0.5 rounded whitespace-pre-wrap break-all',
                    row.type === 'add'
                      ? 'bg-[#10B981]/14 text-[#A7F3D0]'
                      : row.type === 'del'
                        ? 'bg-[#FB7185]/14 text-[#FECDD3]'
                        : row.type === 'hunk'
                          ? 'bg-[#38BDF8]/12 text-[#BAE6FD]'
                          : row.type === 'meta'
                            ? 'text-[#94A3B8]'
                            : 'text-[#DDD6CD]',
                  ]"
                >
                  {{ row.line || " " }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: ACTIVIDAD TÉCNICA REAL (con salida completa expandible de comandos/tests) -->
        <div
          v-else
          class="flex-1 min-h-0 flex flex-col border-t border-white/[0.08]"
        >
          <!-- Filtro por agente + filtro Solo errores -->
          <div class="px-5 py-2.5 border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                @click="selectedAgentFilter = 'all'"
                :class="[
                  'px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer border',
                  selectedAgentFilter === 'all'
                    ? 'bg-[#E09F5A]/20 border-[#E09F5A]/50 text-[#FFFDF9]'
                    : 'bg-white/[0.04] border-white/[0.07] text-[#C8C0B5] hover:text-[#FFFDF9]',
                ]"
              >
                Todos
              </button>
              <button
                v-for="ag in profiles"
                :key="ag.id"
                type="button"
                @click="selectedAgentFilter = ag.id"
                :class="[
                  'px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer border flex items-center gap-1.5',
                  selectedAgentFilter === ag.id
                    ? 'bg-[#E09F5A]/20 border-[#E09F5A]/50 text-[#FFFDF9]'
                    : 'bg-white/[0.04] border-white/[0.07] text-[#C8C0B5] hover:text-[#FFFDF9]',
                ]"
              >
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  :style="{ backgroundColor: ag.color }"
                ></span>
                <span>{{ ag.name }}</span>
              </button>
            </div>

            <button
              type="button"
              @click="onlyErrorsFilter = !onlyErrorsFilter"
              :class="[
                'px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer border flex items-center gap-1.5 whitespace-nowrap',
                onlyErrorsFilter
                  ? 'bg-[#FB7185]/20 border-[#FB7185]/50 text-[#FECDD3]'
                  : 'bg-white/[0.04] border-white/[0.07] text-[#C8C0B5] hover:text-[#FFFDF9]',
              ]"
            >
              <AlertCircle class="w-3.5 h-3.5 text-[#FB7185]" />
              <span>Solo errores</span>
              <span v-if="errorCount > 0" class="tabular-nums text-[11px] text-[#FDA4AF]">
                {{ errorCount }}
              </span>
            </button>
          </div>

          <!-- Stream de herramientas reales -->
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
            <div
              v-if="filteredActivity.length === 0"
              class="h-full flex flex-col items-center justify-center text-center px-6 py-8 space-y-1.5 text-xs text-[#A39B90]"
            >
              <Terminal class="w-5 h-5 text-[#8C847A]" />
              <p class="font-medium text-[#DDD6CD]">
                {{ onlyErrorsFilter ? "Sin errores registrados" : "Sin ejecuciones técnicas registradas aún" }}
              </p>
              <p class="max-w-sm">
                {{
                  onlyErrorsFilter
                    ? "Ningún comando o prueba falló con el filtro actual."
                    : "Cuando tus agentes lean archivos, editen código o ejecuten comandos en OpenCode, verás aquí su registro técnico completo."
                }}
              </p>
            </div>

            <div
              v-for="ev in filteredActivity"
              :key="ev.id || `${ev.agentId}_${ev.callKey || ev.callId}`"
              :class="[
                'rounded-xl bg-black/25 border p-3 space-y-2',
                ev.status === 'error'
                  ? 'border-[#FB7185]/35 bg-[#FB7185]/[0.05]'
                  : 'border-white/[0.08]',
              ]"
            >
              <div class="flex items-center justify-between gap-2 text-xs">
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    :style="{ backgroundColor: profileMap[ev.agentId]?.color || '#E09F5A' }"
                  ></span>
                  <span class="font-semibold text-[#F6EFE6] shrink-0">
                    {{ profileMap[ev.agentId]?.name || ev.agentId }}
                  </span>
                  <span class="text-[#C8C0B5] truncate">
                    · {{ ev.label || ev.toolName || ev.tool }}
                  </span>
                </div>
                <div class="flex items-center gap-2 shrink-0 text-[11px] tabular-nums">
                  <span
                    :class="[
                      'flex items-center gap-1',
                      ev.status === 'error'
                        ? 'text-[#FB7185]'
                        : ev.status === 'completed' || ev.status === 'done'
                          ? 'text-[#34D399]'
                          : 'text-[#FBBF24]',
                    ]"
                  >
                    <AlertCircle v-if="ev.status === 'error'" class="w-3 h-3" />
                    <CheckCircle2
                      v-else-if="ev.status === 'completed' || ev.status === 'done'"
                      class="w-3 h-3"
                    />
                    <Clock v-else class="w-3 h-3" />
                    <span>
                      {{
                        ev.status === "error"
                          ? "Falló"
                          : ev.status === "completed" || ev.status === "done"
                            ? "Hecho"
                            : "En curso"
                      }}
                    </span>
                  </span>
                  <span class="text-[#8C847A]">{{ formatTime(ev.timestamp) }}</span>
                </div>
              </div>

              <div
                v-if="ev.command || ev.target"
                class="font-mono text-[11px] text-[#F6C894] break-all select-text"
              >
                <span v-if="ev.command" class="text-[#8C847A] mr-1">$</span>{{ ev.command || ev.target }}
              </div>

              <!-- Salida completa expandible (especialmente útil para tests/comandos fallidos) -->
              <div
                v-if="getCombinedToolOutput(ev)"
                :class="[
                  'rounded-lg border overflow-hidden',
                  ev.status === 'error'
                    ? 'bg-[#FB7185]/[0.08] border-[#FB7185]/25'
                    : 'bg-white/[0.03] border-white/[0.07]',
                ]"
              >
                <div
                  class="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px] border-b border-white/[0.06]"
                >
                  <button
                    type="button"
                    @click="toggleOutputExpanded(ev)"
                    class="flex items-center gap-1.5 text-[#DDD6CD] hover:text-[#FFFDF9] cursor-pointer"
                  >
                    <ChevronUp v-if="isOutputExpanded(ev)" class="w-3.5 h-3.5" />
                    <ChevronDown v-else class="w-3.5 h-3.5" />
                    <span>
                      {{
                        isOutputExpanded(ev)
                          ? "Ocultar salida completa"
                          : "Ver salida completa"
                      }}
                    </span>
                    <span class="text-[#A39B90] tabular-nums">
                      ({{ countLines(getCombinedToolOutput(ev)) }} líneas{{ ev.outputTruncated ? " · máx. 16 KB" : "" }})
                    </span>
                  </button>

                  <div class="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      @click="copyText(ev.id || ev.callKey, getCombinedToolOutput(ev))"
                      class="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[10px] text-[#EAE4DC] flex items-center gap-1 cursor-pointer"
                    >
                      <Check
                        v-if="copiedId === (ev.id || ev.callKey)"
                        class="w-3 h-3 text-[#34D399]"
                      />
                      <Copy v-else class="w-3 h-3" />
                      <span>{{ copiedId === (ev.id || ev.callKey) ? "Copiado" : "Copiar" }}</span>
                    </button>
                    <button
                      v-if="ev.status === 'error' && isConnected"
                      type="button"
                      @click="requestFixForFailedTool(ev)"
                      class="px-2 py-0.5 rounded-md bg-[#E09F5A]/20 hover:bg-[#E09F5A]/30 border border-[#E09F5A]/40 text-[10px] font-medium text-[#F6C894] flex items-center gap-1 cursor-pointer"
                    >
                      <Send class="w-3 h-3" />
                      <span>Pedir corrección</span>
                    </button>
                  </div>
                </div>

                <pre
                  v-if="isOutputExpanded(ev)"
                  :class="[
                    'px-3 py-2 font-mono text-[11px] whitespace-pre-wrap break-words max-h-72 overflow-auto select-text leading-relaxed',
                    ev.status === 'error' ? 'text-[#FECDD3]' : 'text-[#DDD6CD]',
                  ]"
                >{{ getCombinedToolOutput(ev) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
