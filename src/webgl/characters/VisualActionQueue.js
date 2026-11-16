const RAPID_READ_TOOLS = new Set([
  "read",
  "view",
  "grep",
  "search",
  "glob",
  "find",
  "list",
  "ls",
  "todoread",
]);

function extractToolKey(label = "", explicitTool = null) {
  if (explicitTool) return String(explicitTool).toLowerCase();
  const lower = String(label || "").toLowerCase();
  if (lower.includes("leyendo código") || lower.includes("read")) return "read";
  if (lower.includes("buscando") || lower.includes("grep")) return "grep";
  if (lower.includes("explorando") || lower.includes("glob")) return "glob";
  if (lower.includes("listando")) return "list";
  if (lower.includes("editando")) return "edit";
  if (lower.includes("escribiendo")) return "write";
  if (lower.includes("terminal") || lower.includes("comando")) return "bash";
  if (lower.includes("pensando")) return "thinking";
  return null;
}

export class VisualActionQueue {
  constructor({
    meetingHoldMs = 5000,
    meetingExtendMs = 4500,
    deskDwellMs = 4000,
    stepDisplayMs = 950,
    maxMeetingWalkWaitMs = 9500,
  } = {}) {
    this.meetingHoldMs = meetingHoldMs;
    this.meetingExtendMs = meetingExtendMs;
    this.deskDwellMs = deskDwellMs;
    this.stepDisplayMs = stepDisplayMs;
    this.maxMeetingWalkWaitMs = maxMeetingWalkWaitMs;

    this.simTimeMs = 0;
    this.agents = new Map();
    this.meeting = null;
  }

  _ensureAgent(agentId) {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        agentId,
        phase: "idle", // idle | delegation_meeting | walk_to_desk | thinking | working | completed
        meetingSeated: false,
        deskSeated: false,
        deskWorkStartedAt: null,
        lastStepShownAt: 0,
        currentStep: null,
        pendingBursts: [],
        pendingCompletion: null,
        activeLiveSession: false,
      });
    }
    return this.agents.get(agentId);
  }

  getAgentState(agentId) {
    const entry = this.agents.get(agentId);
    if (!entry) return null;
    return {
      ...entry,
      pendingBursts: entry.pendingBursts.map((b) => ({ ...b })),
      pendingCompletion: entry.pendingCompletion
        ? { ...entry.pendingCompletion }
        : null,
      currentStep: entry.currentStep ? { ...entry.currentStep } : null,
    };
  }

  hasActiveChoreography(agentId) {
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    return (
      entry.activeLiveSession ||
      entry.phase === "delegation_meeting" ||
      entry.phase === "walk_to_desk" ||
      Boolean(entry.pendingCompletion) ||
      entry.pendingBursts.length > 0
    );
  }

  isInMeeting(agentId) {
    return Boolean(this.meeting?.participants?.has(agentId));
  }

  _coalesceStep(entry, rawStep) {
    const step = {
      phase: rawStep.phase === "thinking" ? "thinking" : "working",
      label: rawStep.label || (rawStep.phase === "thinking" ? "Pensando..." : "Trabajando..."),
      file: rawStep.file || null,
      toolKey: extractToolKey(rawStep.label, rawStep.toolName),
      burstCount: 1,
    };

    const queue = entry.pendingBursts;
    const prev = queue[queue.length - 1];

    if (prev) {
      const bothThinking = prev.phase === "thinking" && step.phase === "thinking";
      const bothRapidRead =
        prev.phase === "working" &&
        step.phase === "working" &&
        RAPID_READ_TOOLS.has(prev.toolKey) &&
        RAPID_READ_TOOLS.has(step.toolKey);
      const sameTool =
        prev.toolKey && step.toolKey && prev.toolKey === step.toolKey;

      if (bothThinking || bothRapidRead || sameTool) {
        const nextCount = (prev.burstCount || 1) + 1;
        prev.label = step.label;
        prev.file = step.file || prev.file;
        prev.toolKey = step.toolKey || prev.toolKey;
        prev.burstCount = nextCount;
        return;
      }
    }

    queue.push(step);
    if (queue.length > 3) {
      // Conservar el primer paso distintivo y los últimos dos para mantener ritmo legible
      queue.splice(1, queue.length - 3);
    }
  }

  startDelegation({
    hostAgentId = "architect",
    subagentId = null,
    topic = "Delegando subtarea",
  } = {}) {
    if (!hostAgentId || !subagentId || hostAgentId === subagentId) {
      return null;
    }

    const isNewMeeting = !this.meeting;
    if (isNewMeeting) {
      this.meeting = {
        hostAgentId,
        participants: new Set([hostAgentId]),
        seatedAgents: new Set(),
        topic,
        holdUntil: null,
        maxWalkWaitUntil: this.simTimeMs + this.maxMeetingWalkWaitMs,
      };
    }

    const newlyInvited = [];
    if (!this.meeting.participants.has(hostAgentId)) {
      this.meeting.participants.add(hostAgentId);
      newlyInvited.push(hostAgentId);
    } else if (isNewMeeting) {
      newlyInvited.push(hostAgentId);
    }

    if (!this.meeting.participants.has(subagentId)) {
      this.meeting.participants.add(subagentId);
      newlyInvited.push(subagentId);
      // Si se suma un nuevo subagente a la reunión activa, esperar a que se siente
      if (this.meeting.holdUntil !== null) {
        this.meeting.holdUntil = null;
        this.meeting.maxWalkWaitUntil = Math.max(
          this.meeting.maxWalkWaitUntil,
          this.simTimeMs + this.maxMeetingWalkWaitMs,
        );
      }
    }

    this.meeting.topic = topic || this.meeting.topic;

    for (const id of [hostAgentId, subagentId]) {
      const entry = this._ensureAgent(id);
      entry.activeLiveSession = true;
      entry.phase = "delegation_meeting";
      entry.deskSeated = false;
      entry.deskWorkStartedAt = null;
      entry.pendingCompletion = null;
      if (newlyInvited.includes(id)) {
        entry.meetingSeated = false;
      }
    }

    return {
      isNewMeeting,
      hostAgentId,
      subagentId,
      participants: Array.from(this.meeting.participants),
    };
  }

  markMeetingSeated(agentId) {
    if (!this.meeting || !this.meeting.participants.has(agentId)) return false;

    const entry = this._ensureAgent(agentId);
    entry.meetingSeated = true;
    this.meeting.seatedAgents.add(agentId);

    const allSeated = Array.from(this.meeting.participants).every((id) =>
      this.meeting.seatedAgents.has(id),
    );
    if (allSeated) {
      const duration =
        this.meeting.holdUntil === null
          ? this.meetingHoldMs
          : this.meetingExtendMs;
      this.meeting.holdUntil = Math.max(
        this.meeting.holdUntil || 0,
        this.simTimeMs + duration,
      );
    }
    return true;
  }

  enqueueWork(
    agentId,
    {
      phase = "working",
      label = "Trabajando en OpenCode",
      file = null,
      toolName = null,
      isPhysicallyAtDesk = false,
    } = {},
    handlers = {},
  ) {
    const entry = this._ensureAgent(agentId);
    const startingFreshRun =
      !entry.activeLiveSession || entry.phase === "completed" || entry.phase === "idle";

    entry.activeLiveSession = true;
    entry.pendingCompletion = null;

    // 1. Si está en reunión de delegación, no romper la reunión: encolar y fusionar trabajo
    if (entry.phase === "delegation_meeting" && this.isInMeeting(agentId)) {
      this._coalesceStep(entry, { phase, label, file, toolName });
      handlers.onQueueDuringMeeting?.(agentId, { phase, label, file });
      return "queued_meeting";
    }

    // 2. Si está caminando al escritorio o todavía no está sentado en su silla,
    //    coalescer en cola sin reiniciar la ruta A*.
    if (!isPhysicallyAtDesk || entry.phase === "walk_to_desk") {
      entry.phase = "walk_to_desk";
      entry.deskSeated = false;
      this._coalesceStep(entry, { phase, label, file, toolName });
      handlers.onStartWalkToDesk?.(agentId, {
        phase,
        label,
        file,
      });
      return "queued_walk";
    }

    // 3. Ya está sentado en su escritorio
    if (startingFreshRun || !entry.deskSeated || entry.deskWorkStartedAt === null) {
      entry.deskSeated = true;
      entry.deskWorkStartedAt = this.simTimeMs;
    }

    const step = {
      phase: phase === "thinking" ? "thinking" : "working",
      label,
      file,
      toolKey: extractToolKey(label, toolName),
      burstCount: 1,
    };

    const elapsedSinceStep = this.simTimeMs - entry.lastStepShownAt;
    const isPhaseSwitch =
      entry.currentStep && entry.currentStep.phase !== step.phase;
    const isMeaningfulEdit =
      step.toolKey && !RAPID_READ_TOOLS.has(step.toolKey);

    if (
      startingFreshRun ||
      !entry.currentStep ||
      isPhaseSwitch ||
      isMeaningfulEdit ||
      elapsedSinceStep >= this.stepDisplayMs
    ) {
      entry.phase = step.phase;
      entry.currentStep = step;
      entry.lastStepShownAt = this.simTimeMs;
      handlers.onApplyDeskStep?.(agentId, step);
      return "applied_desk";
    }

    this._coalesceStep(entry, step);
    return "coalesced_desk";
  }

  enqueueCompletion(
    agentId,
    {
      status = "passed",
      label = "Tarea finalizada",
      file = null,
      idleCooldownSec = 15,
      urgent = false,
      isPhysicallyAtDesk = false,
    } = {},
    handlers = {},
  ) {
    const entry = this._ensureAgent(agentId);
    const completion = {
      status,
      label,
      file,
      idleCooldownSec,
      urgent: Boolean(urgent),
    };

    // Bloqueos urgentes (permiso CLI, pregunta interactiva, error fatal)
    if (urgent) {
      if (this.isInMeeting(agentId)) {
        this.meeting.participants.delete(agentId);
        this.meeting.seatedAgents.delete(agentId);
        if (this.meeting.participants.size <= 1) {
          this.meeting = null;
        }
      }
      entry.pendingBursts = [];
      entry.pendingCompletion = null;
      entry.activeLiveSession = false;
      entry.phase = "completed";
      if (isPhysicallyAtDesk) {
        entry.deskSeated = true;
        handlers.onApplyCompletion?.(agentId, completion);
        return "applied_urgent";
      }
      entry.phase = "walk_to_desk";
      entry.deskSeated = false;
      entry.pendingCompletion = completion;
      handlers.onStartWalkToDesk?.(agentId, {
        phase: "working",
        label,
        file,
      });
      return "walk_urgent";
    }

    // Si está en reunión de delegación, diferir cierre hasta terminar reunión + caminata + 4s escritorio
    if (entry.phase === "delegation_meeting" && this.isInMeeting(agentId)) {
      entry.pendingCompletion = completion;
      return "deferred_meeting";
    }

    // Si aún no está sentado en su escritorio, asegurar llegada y estancia mínima de 4s
    if (!isPhysicallyAtDesk || entry.phase === "walk_to_desk" || !entry.deskSeated) {
      entry.phase = "walk_to_desk";
      entry.deskSeated = false;
      entry.pendingCompletion = completion;
      handlers.onStartWalkToDesk?.(agentId, {
        phase: "working",
        label: entry.pendingBursts[0]?.label || label || "Procesando subtarea",
        file: entry.pendingBursts[0]?.file || file,
      });
      return "deferred_walk";
    }

    // Si está sentado pero aún hay pasos coalescidos o no se ha cumplido el mínimo de 4s
    const elapsedDeskMs =
      this.simTimeMs - (entry.deskWorkStartedAt ?? this.simTimeMs);
    if (entry.pendingBursts.length > 0 || elapsedDeskMs < this.deskDwellMs) {
      entry.pendingCompletion = completion;
      return "deferred_dwell";
    }

    entry.phase = "completed";
    entry.activeLiveSession = false;
    entry.pendingCompletion = null;
    handlers.onApplyCompletion?.(agentId, completion);
    return "applied_now";
  }

  markDeskSeated(agentId, handlers = {}) {
    const entry = this._ensureAgent(agentId);
    entry.deskSeated = true;
    entry.deskWorkStartedAt = this.simTimeMs;
    entry.lastStepShownAt = this.simTimeMs;

    let firstStep = entry.pendingBursts.shift() || entry.currentStep || null;
    if (!firstStep) {
      firstStep = {
        phase: "working",
        label: entry.pendingCompletion?.label || "Procesando tarea",
        file: entry.pendingCompletion?.file || null,
        toolKey: null,
        burstCount: 1,
      };
    }

    // Si sólo tenemos el resultado final en espera (p. ej. OpenCode terminó mientras caminaba),
    // mantener etiqueta activa de trabajo en el escritorio durante los 4s mínimos.
    if (
      entry.pendingCompletion &&
      firstStep.label === "Tarea finalizada"
    ) {
      firstStep.label = "Consolidando resultado";
    }

    entry.phase = firstStep.phase;
    entry.currentStep = firstStep;
    handlers.onApplyDeskStep?.(agentId, firstStep);
    return firstStep;
  }

  tick(deltaMs, handlers = {}) {
    const safeDelta = Math.max(0, Number(deltaMs) || 0);
    this.simTimeMs += safeDelta;

    // 1. Verificar vencimiento de retención mínima en Sala de Reuniones (4.5s - 6s tras sentarse)
    if (this.meeting) {
      const fallbackReady =
        this.meeting.holdUntil === null &&
        this.simTimeMs >= this.meeting.maxWalkWaitUntil;
      if (fallbackReady) {
        if (this.meeting.seatedAgents.size > 0) {
          this.meeting.holdUntil = this.simTimeMs + this.meetingExtendMs;
        } else {
          this.meeting.holdUntil = this.simTimeMs;
        }
      }

      if (
        this.meeting.holdUntil !== null &&
        this.simTimeMs >= this.meeting.holdUntil
      ) {
        const departingIds = Array.from(this.meeting.participants);
        this.meeting = null;

        const dispatched = [];
        for (const id of departingIds) {
          const entry = this._ensureAgent(id);
          entry.meetingSeated = false;
          entry.deskSeated = false;
          entry.deskWorkStartedAt = null;
          entry.phase = "walk_to_desk";
          const nextInfo = entry.pendingBursts[0] || {
            phase: "working",
            label:
              entry.pendingCompletion?.label &&
              entry.pendingCompletion.label !== "Tarea finalizada"
                ? entry.pendingCompletion.label
                : "Ejecutando subtarea",
            file: entry.pendingCompletion?.file || null,
          };
          dispatched.push({ agentId: id, step: nextInfo });
        }

        handlers.onDispatchFromMeeting?.(dispatched);
      }
    }

    // 2. Avanzar ráfagas coalescidas y liberar cierres tras >= 4s sentado en escritorio
    for (const entry of this.agents.values()) {
      if (!entry.deskSeated) continue;
      if (entry.phase !== "thinking" && entry.phase !== "working") continue;

      if (
        entry.pendingBursts.length > 0 &&
        this.simTimeMs - entry.lastStepShownAt >= this.stepDisplayMs
      ) {
        const nextStep = entry.pendingBursts.shift();
        entry.phase = nextStep.phase;
        entry.currentStep = nextStep;
        entry.lastStepShownAt = this.simTimeMs;
        handlers.onApplyDeskStep?.(entry.agentId, nextStep);
        continue;
      }

      if (
        entry.pendingCompletion &&
        entry.pendingBursts.length === 0
      ) {
        const elapsedDesk =
          this.simTimeMs - (entry.deskWorkStartedAt ?? this.simTimeMs);
        if (entry.pendingCompletion.urgent || elapsedDesk >= this.deskDwellMs) {
          const completion = entry.pendingCompletion;
          entry.pendingCompletion = null;
          entry.phase = "completed";
          entry.activeLiveSession = false;
          handlers.onApplyCompletion?.(entry.agentId, completion);
        }
      }
    }
  }

  clearAgent(agentId) {
    this.agents.delete(agentId);
    if (this.meeting) {
      this.meeting.participants.delete(agentId);
      this.meeting.seatedAgents.delete(agentId);
      if (this.meeting.participants.size === 0) {
        this.meeting = null;
      }
    }
  }

  reset() {
    this.agents.clear();
    this.meeting = null;
  }
}
