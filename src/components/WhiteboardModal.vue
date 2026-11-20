<script setup>
import { ref, watch } from "vue";
import { X, ClipboardList, Plus, Trash2, Archive } from "@lucide/vue";
import { openCodeBridge } from "../opencode/OpenCodeBridgeClient";

const props = defineProps({
  open: { type: Boolean, default: false },
  notes: { type: Array, default: () => [] },
  projectName: { type: String, default: "" },
});

const emit = defineEmits(["close", "updated"]);

const draftText = ref("");
const isSaving = ref(false);
const feedbackError = ref(null);
const archivingId = ref(null);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      feedbackError.value = null;
      openCodeBridge.fetchWhiteboard();
    }
  },
);

async function handleAddNote() {
  const clean = draftText.value.trim();
  if (!clean || isSaving.value) return;
  isSaving.value = true;
  feedbackError.value = null;
  const res = await openCodeBridge.addWhiteboardNote({
    text: clean,
    agentId: "human",
    agentName: "Tech Lead (Tú)",
    authorType: "human",
    color: "#E09F5A",
  });
  isSaving.value = false;
  if (res.ok) {
    draftText.value = "";
    emit("updated", res.notes || []);
  } else {
    feedbackError.value =
      res.error || "No se pudo guardar la nota. Verifica que el puente (:4097) esté activo.";
  }
}

async function handleArchiveNote(noteId) {
  if (!noteId || archivingId.value) return;
  archivingId.value = noteId;
  feedbackError.value = null;
  const res = await openCodeBridge.archiveWhiteboardNote({ id: noteId });
  archivingId.value = null;
  if (res.ok) {
    emit("updated", res.notes || []);
  } else {
    feedbackError.value = res.error || "No se pudo archivar la nota.";
  }
}

async function handleClearAll() {
  if (archivingId.value || !props.notes.length) return;
  archivingId.value = "__all__";
  feedbackError.value = null;
  const res = await openCodeBridge.archiveWhiteboardNote({ clearAll: true });
  archivingId.value = null;
  if (res.ok) {
    emit("updated", res.notes || []);
  } else {
    feedbackError.value = res.error || "No se pudo limpiar la pizarra.";
  }
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
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
        class="w-[min(600px,95vw)] max-h-[84vh] hud-glass-elevated rounded-2xl flex flex-col overflow-hidden"
      >
        <!-- Cabecera -->
        <div
          class="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-3 shrink-0"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <ClipboardList class="w-4 h-4 text-[#E09F5A] shrink-0" />
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-[#F6EFE6] truncate">
                Pizarra de Arquitectura
              </h2>
              <p class="text-[11px] text-[#B5AEA4] truncate">
                {{
                  projectName
                    ? `${projectName} · Memoria local persistente fuera de git`
                    : "Memoria local persistente del equipo (visible en 3D y vía MCP)"
                }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button
              v-if="notes.length > 0"
              type="button"
              @click="handleClearAll"
              :disabled="archivingId === '__all__'"
              class="px-2.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] font-medium text-[#FDA4AF] flex items-center gap-1 cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <Trash2 class="w-3 h-3" />
              <span>Limpiar</span>
            </button>
            <button
              type="button"
              @click="emit('close')"
              aria-label="Cerrar pizarra"
              class="p-1.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer"
            >
              <X class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Formulario para fijar nueva decisión -->
        <form
          @submit.prevent="handleAddNote"
          class="px-5 py-3.5 border-b border-white/[0.08] space-y-2 shrink-0"
        >
          <div class="flex items-center gap-2">
            <input
              v-model="draftText"
              type="text"
              maxlength="220"
              placeholder="Fijar una decisión, contrato o recordatorio para el equipo..."
              class="flex-1 min-w-0 px-3 py-2 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] placeholder:text-[#8C847A] focus:outline-none focus:border-[#E09F5A]/60"
            />
            <button
              type="submit"
              :disabled="isSaving || !draftText.trim()"
              class="px-3.5 py-2 rounded-xl bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-45"
            >
              <Plus class="w-3.5 h-3.5" />
              <span>{{ isSaving ? "Guardando..." : "Fijar nota" }}</span>
            </button>
          </div>
          <div v-if="feedbackError" class="text-[11px] text-[#FDA4AF]">
            {{ feedbackError }}
          </div>
        </form>

        <!-- Lista de notas persistidas -->
        <div class="flex-1 min-h-0 overflow-y-auto p-5 space-y-2.5">
          <div
            v-if="notes.length === 0"
            class="py-10 text-center space-y-1.5 text-xs text-[#A39B90]"
          >
            <p class="font-medium text-[#E7E1D8]">La pizarra está despejada</p>
            <p class="max-w-sm mx-auto leading-relaxed">
              Las notas que fijes aquí aparecerán al instante en la pizarra 3D y tus agentes podrán leerlas con <span class="font-mono text-[#F6C894]">leer_pizarra</span>.
            </p>
          </div>

          <div
            v-for="note in notes"
            :key="note.id"
            class="rounded-xl bg-black/25 border border-white/[0.08] p-3.5 flex items-start justify-between gap-3"
          >
            <div class="flex items-start gap-2.5 min-w-0 flex-1">
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                :style="{ backgroundColor: note.color || '#E09F5A' }"
              ></span>
              <div class="min-w-0 space-y-1">
                <div class="flex items-center gap-2 text-[11px] text-[#B5AEA4]">
                  <span class="font-semibold text-[#F6EFE6]">
                    {{ note.agentName || "Equipo" }}
                  </span>
                  <span v-if="note.authorType === 'human'" class="text-[#E09F5A]">
                    · Tú
                  </span>
                  <span class="tabular-nums">· {{ formatTime(note.createdAt) }}</span>
                </div>
                <p class="text-xs text-[#F3EFE8] leading-relaxed select-text break-words">
                  {{ note.text }}
                </p>
              </div>
            </div>

            <button
              type="button"
              @click="handleArchiveNote(note.id)"
              :disabled="archivingId === note.id"
              title="Archivar nota"
              aria-label="Archivar nota"
              class="p-1.5 rounded-lg text-[#8C847A] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer shrink-0 disabled:opacity-40"
            >
              <Archive class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>
