<script setup>
import { ref } from "vue";
import { X, Users, Send } from "@lucide/vue";

const props = defineProps({
  open: { type: Boolean, default: false },
  isConnected: { type: Boolean, default: false },
});

const emit = defineEmits(["close", "launch-standup"]);

const STANDUP_TEMPLATES = [
  {
    id: "status",
    title: "Estado y bloqueos",
    topic: "Standup · Estado y bloqueos",
    prompt:
      "Hagamos un standup rápido en la sala de reuniones: resumid en qué parte del proyecto estamos, qué archivos relevantes han cambiado y si hay algún bloqueo o riesgo pendiente.",
  },
  {
    id: "milestone",
    title: "Definir siguiente hito",
    topic: "Planificación · Siguiente hito",
    prompt:
      "Reunámonos para alinear el siguiente hito: revisa la pizarra de arquitectura (leer_pizarra), propón los próximos 3 pasos priorizados y reparte responsabilidades claras con el equipo.",
  },
  {
    id: "contracts",
    title: "Sincronizar Frontend y Backend",
    topic: "Sync · Contratos FE / BE",
    prompt:
      "Hagamos una sincronización rápida entre Frontend, Backend y QA: verificad contratos de datos, eventos y posibles inconsistencias, y dejad las decisiones clave anotadas en la pizarra.",
  },
];

const customPrompt = ref("");
const isLaunching = ref(false);

function triggerTemplate(tpl) {
  if (isLaunching.value) return;
  isLaunching.value = true;
  emit("launch-standup", {
    topic: tpl.topic,
    prompt: tpl.prompt,
  });
  setTimeout(() => {
    isLaunching.value = false;
  }, 300);
}

function triggerCustom() {
  const clean = customPrompt.value.trim();
  if (!clean || isLaunching.value) return;
  isLaunching.value = true;
  emit("launch-standup", {
    topic: clean.slice(0, 36),
    prompt: clean,
  });
  customPrompt.value = "";
  setTimeout(() => {
    isLaunching.value = false;
  }, 300);
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
        class="w-[min(520px,95vw)] hud-glass-elevated rounded-2xl flex flex-col overflow-hidden"
      >
        <div
          class="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-3"
        >
          <div class="flex items-center gap-2.5 min-w-0">
            <Users class="w-4 h-4 text-[#E09F5A] shrink-0" />
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-[#F6EFE6] truncate">
                Standup rápido con el equipo
              </h2>
              <p class="text-[11px] text-[#B5AEA4] truncate">
                Reúne al equipo en la mesa y envía la agenda al Tech Lead
              </p>
            </div>
          </div>
          <button
            type="button"
            @click="emit('close')"
            aria-label="Cerrar standup"
            class="p-1.5 rounded-lg text-[#B5AEA4] hover:text-[#FFFDF9] hover:bg-white/[0.07] cursor-pointer"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="p-5 space-y-4">
          <div class="space-y-2">
            <div class="text-[11px] text-[#B5AEA4]">Agendas rápidas (1 clic)</div>
            <div class="space-y-1.5">
              <button
                v-for="tpl in STANDUP_TEMPLATES"
                :key="tpl.id"
                type="button"
                :disabled="isLaunching"
                @click="triggerTemplate(tpl)"
                class="w-full text-left px-3.5 py-2.5 rounded-xl bg-black/25 hover:bg-white/[0.08] border border-white/[0.08] hover:border-[#E09F5A]/45 transition-colors cursor-pointer space-y-0.5 disabled:opacity-50"
              >
                <div class="text-xs font-semibold text-[#F6EFE6]">
                  {{ tpl.title }}
                </div>
                <div class="text-[11px] text-[#B5AEA4] line-clamp-2 leading-relaxed">
                  {{ tpl.prompt }}
                </div>
              </button>
            </div>
          </div>

          <form @submit.prevent="triggerCustom" class="space-y-2 pt-2 border-t border-white/[0.08]">
            <label class="block text-[11px] text-[#B5AEA4]">
              O escribe un mensaje propio para la reunión
            </label>
            <textarea
              v-model="customPrompt"
              rows="2"
              placeholder="Ej: Revisemos los errores de compilación antes del despliegue..."
              class="w-full px-3 py-2 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-[#F3EFE8] placeholder:text-[#8C847A] focus:outline-none focus:border-[#E09F5A]/60 resize-none"
            ></textarea>

            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] text-[#A39B90]">
                {{
                  isConnected
                    ? "Convocará en 3D y enviará al Tech Lead"
                    : "Sin conexión OpenCode: solo convocará la reunión en 3D"
                }}
              </span>
              <button
                type="submit"
                :disabled="isLaunching || !customPrompt.trim()"
                class="px-3.5 py-1.5 rounded-xl bg-[#E09F5A] hover:bg-[#E7AF72] text-xs font-semibold text-[#1B1714] flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-45"
              >
                <Send class="w-3.5 h-3.5" />
                <span>Convocar</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </transition>
</template>
