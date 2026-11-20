<script setup>
import { ref, computed, watch } from "vue";
import {
  X,
  RefreshCw,
  GitBranch,
  Terminal,
  FileCode2,
  AlertCircle,
  CheckCircle2,
  Clock,
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

const emit = defineEmits(["close", "refresh-workspace", "open-settings"]);

const activeTab = ref(props.initialTab || "git");
const selectedAgentFilter = ref(props.initialAgentId || "all");
const selectedFilePath = ref(null);
const diffState = ref({
  loading: false,
  error: null,
  diff: "",
  truncated: false,
  untracked: false,
});
const isRefreshing = ref(false);

const profileMap = computed(() =>
  Object.fromEntries((props.profiles || []).map((p) => [p.id, p])),
);

const changes = computed(() =>
  Array.isArray(props.workspace?.changes) ? props.workspace.changes : [],
);

const filteredActivity = computed(() => {
  const list = Array.isArray(props.toolActivity) ? props.toolActivity : [];
  if (selectedAgentFilter.value === "all") return list;
  return list.filter((item) => item.agentId === selectedAgentFilter.value);
});

const parsedDiffLines = computed(() => {
  const raw = String(diffState.value.diff || "");
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line, index) => {
    let type = "context";
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) {
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
    await handleRefresh();
    if (changes.value.length > 0) {
      const stillExists = changes.value.some((c) => c.path === selectedFilePath.value);
      if (!stillExists) {
        await selectFile(changes.value[0].path);
      }
    } else {
      selectedFilePath.value = null;
      diffState.value = { loading: false, error: null, diff: "", truncated: false, untracked: false };
    }
  },
);

watch(
  () => props.initialAgentId,
  (nextId) => {
    if (props.open && nextId) {
      selectedAgentFilter.value = nextId;
    }
  },
);

async function handleRefresh() {
  isRefreshing.value = true;
  emit("refresh-workspace");
  await openCodeBridge.fetchWorkspaceSummary();
  if (selectedFilePath.value) {
    await selectFile(selectedFilePath.value);
  }
  isRefreshing.value = false;
}

async function selectFile(filePath) {
  if (!filePath) return;
  selectedFilePath.value = filePath;
  diffState.value = { loading: true, error: null, diff: "", truncated: false, untracked: false };
  const res = await openCodeBridge.fetchWorkspaceDiff(filePath);
  if (res.ok) {
    diffState.value = {
      loading: false,
      error: null,
      diff: res.diff || "",
      truncated: Boolean(res.truncated),
      untracked: Boolean(res.isUntracked || res.untracked),
    };
  } else {
    diffState.value = {
      loading: false,
      error: res.error || "No se pudo obtener el diff del archivo.",
      diff: "",
      truncated: false,
      untracked: false,
    };
  }
}

function statusBadgeLabel(status) {
  if (status === "added" || status === "untracked") return "N";
  if (status === "deleted") return "E";
  if (status === "renamed") return "R";
  return "M";
}

function statusBadgeClass(status) {
  if (status === "added" || status === "untracked") return "text-[#34D399]";
  if (status === "deleted") return "text-[#FB7185]";
  if (status === "renamed") return "text-[#7DD3FC]";
  return "text-[#FBBF24]";
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
        class="w-[min(920px,96vw)] h-[min(82vh,680px)] hud-glass-elevated rounded-2xl flex flex-col overflow-hidden"
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
                    · rama {{ workspace.branch || "HEAD" }} · {{ changes.length }} cambios
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
              title="Actualizar estado Git"
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
            class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/25 border border-white/[0.08] w-[min(320px,100%)]"
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
              <span>Cambios Git</span>
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

        <!-- TAB 1: CAMBIOS GIT -->
        <div
          v-if="activeTab === 'git'"
          class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[270px_1fr] border-t border-white/[0.08]"
        >
          <!-- Lista de archivos modificados -->
          <div class="border-b md:border-b-0 md:border-r border-white/[0.08] overflow-y-auto p-3 space-y-1">
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

            <div
              v-else-if="changes.length === 0"
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
                  :class="['font-mono text-[11px] font-semibold w-3 shrink-0', statusBadgeClass(item.status)]"
                >
                  {{ statusBadgeLabel(item.status) }}
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
          </div>

          <!-- Visor de Diff unificado -->
          <div class="min-h-0 flex flex-col bg-black/20">
            <div
              v-if="selectedFilePath"
              class="px-4 py-2 border-b border-white/[0.07] flex items-center justify-between gap-2 text-[11px] text-[#C8C0B5] shrink-0"
            >
              <span class="font-mono truncate select-text text-[#F3EFE8]">
                {{ selectedFilePath }}
              </span>
              <span v-if="diffState.untracked" class="text-[#34D399] shrink-0">
                Archivo nuevo
              </span>
              <span v-else-if="diffState.truncated" class="text-[#FBBF24] shrink-0">
                Vista truncada (64 KB)
              </span>
            </div>

            <div class="flex-1 min-h-0 overflow-auto p-3 font-mono text-[11px] leading-relaxed select-text">
              <div v-if="diffState.loading" class="text-[#A39B90] p-2">
                Cargando diff...
              </div>
              <div v-else-if="diffState.error" class="text-[#FDA4AF] p-2">
                {{ diffState.error }}
              </div>
              <div v-else-if="!selectedFilePath" class="text-[#8C847A] p-4 text-center font-sans text-xs">
                Selecciona un archivo de la izquierda para inspeccionar sus cambios.
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

        <!-- TAB 2: ACTIVIDAD TÉCNICA REAL -->
        <div
          v-else
          class="flex-1 min-h-0 flex flex-col border-t border-white/[0.08]"
        >
          <!-- Filtro por agente -->
          <div class="px-5 py-2.5 border-b border-white/[0.07] flex flex-wrap items-center gap-1.5 shrink-0">
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

          <!-- Stream de herramientas reales -->
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            <div
              v-if="filteredActivity.length === 0"
              class="h-full flex flex-col items-center justify-center text-center px-6 py-8 space-y-1.5 text-xs text-[#A39B90]"
            >
              <Terminal class="w-5 h-5 text-[#8C847A]" />
              <p class="font-medium text-[#DDD6CD]">Sin ejecuciones técnicas registradas aún</p>
              <p class="max-w-sm">
                Cuando tus agentes lean archivos, editen código o ejecuten comandos en OpenCode, verás aquí su registro técnico real.
              </p>
            </div>

            <div
              v-for="ev in filteredActivity"
              :key="`${ev.agentId}_${ev.callId}`"
              class="rounded-xl bg-black/25 border border-white/[0.08] p-3 space-y-1.5"
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
                  <span class="text-[#C8C0B5] truncate">· {{ ev.label || ev.tool }}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0 text-[11px] tabular-nums">
                  <span
                    :class="[
                      'flex items-center gap-1',
                      ev.status === 'error'
                        ? 'text-[#FB7185]'
                        : ev.status === 'completed'
                          ? 'text-[#34D399]'
                          : 'text-[#FBBF24]',
                    ]"
                  >
                    <AlertCircle v-if="ev.status === 'error'" class="w-3 h-3" />
                    <CheckCircle2 v-else-if="ev.status === 'completed'" class="w-3 h-3" />
                    <Clock v-else class="w-3 h-3" />
                    <span>
                      {{
                        ev.status === "error"
                          ? "Error"
                          : ev.status === "completed"
                            ? "Hecho"
                            : "En curso"
                      }}
                    </span>
                  </span>
                  <span class="text-[#8C847A]">{{ formatTime(ev.timestamp) }}</span>
                </div>
              </div>

              <div
                v-if="ev.target"
                class="font-mono text-[11px] text-[#F6C894] truncate select-text"
              >
                {{ ev.target }}
              </div>

              <div
                v-if="ev.error"
                class="rounded-lg bg-[#FB7185]/12 border border-[#FB7185]/25 px-2.5 py-1.5 font-mono text-[11px] text-[#FECDD3] whitespace-pre-wrap select-text"
              >
                {{ ev.error }}
              </div>

              <details
                v-else-if="ev.output"
                class="rounded-lg bg-white/[0.03] border border-white/[0.06]"
              >
                <summary class="px-2.5 py-1 text-[11px] text-[#B5AEA4] cursor-pointer select-none">
                  Ver salida del comando
                </summary>
                <pre
                  class="px-2.5 pb-2 pt-1 font-mono text-[11px] text-[#DDD6CD] whitespace-pre-wrap break-words max-h-40 overflow-auto select-text"
                >{{ ev.output }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
