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
    meetingExtendMs = 5000,
    socialHoldMinMs = 12000,
    socialHoldMaxMs = 15000,
    approachRescueMs = 14000,
    deskDwellMs = 4000,
    stepDisplayMs = 950,
    dialogueTurnMs = 2200,
  } = {}) {
    this.meetingHoldMs = meetingHoldMs;
    this.meetingExtendMs = meetingExtendMs;
    this.socialHoldMinMs = socialHoldMinMs;
    this.socialHoldMaxMs = socialHoldMaxMs;
    this.approachRescueMs = approachRescueMs;
    this.deskDwellMs = deskDwellMs;
    this.stepDisplayMs = stepDisplayMs;
    this.dialogueTurnMs = dialogueTurnMs;

    this.simTimeMs = 0;
    this.barrierSeq = 0;
    this.agents = new Map();
    this.barriers = new Map();
    this.agentBarrierMap = new Map();
    this.meeting = null;
  }

  _pickSocialDurationMs() {
    const min = this.socialHoldMinMs;
    const max = Math.max(min, this.socialHoldMaxMs);
    return min + Math.random() * (max - min);
  }

  _ensureAgent(agentId) {
    if (!this.agents.has(agentId)) {
      this.agents.set(agentId, {
        agentId,
        phase: "idle", // idle | barrier_approaching | barrier_engaged | walk_to_desk | thinking | working | completed
        activeBarrierId: null,
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

  getBarrier(barrierId) {
    return this.barriers.get(barrierId) || null;
  }

  getAgentBarrier(agentId) {
    const barrierId = this.agentBarrierMap.get(agentId);
    if (!barrierId) return null;
    return this.barriers.get(barrierId) || null;
  }

  hasActiveBarrier(agentId) {
    return Boolean(this.getAgentBarrier(agentId));
  }

  hasActiveChoreography(agentId) {
    const entry = this.agents.get(agentId);
    if (!entry) return false;
    return (
      Boolean(this.getAgentBarrier(agentId)) ||
      entry.activeLiveSession ||
      entry.phase === "barrier_approaching" ||
      entry.phase === "barrier_engaged" ||
      entry.phase === "walk_to_desk" ||
      Boolean(entry.pendingCompletion) ||
      entry.pendingBursts.length > 0
    );
  }

  isInMeeting(agentId) {
    const barrier = this.getAgentBarrier(agentId);
    return Boolean(
      barrier &&
        (barrier.kind === "delegation" || barrier.kind === "team_meeting"),
    );
  }

  _syncMeetingMirror(barrier) {
    if (!barrier || (barrier.kind !== "delegation" && barrier.kind !== "team_meeting")) {
      return;
    }
    const seatedSet = new Set();
    for (const p of barrier.participants.values()) {
      if (p.ready) seatedSet.add(p.agentId);
    }
    this.meeting = {
      barrierId: barrier.id,
      hostAgentId: barrier.hostAgentId,
      participants: new Set(barrier.participants.keys()),
      seatedAgents: seatedSet,
      topic: barrier.topic,
      phase: barrier.phase,
      holdUntil: barrier.engagedUntil,
    };
  }

  startBarrier(
    {
      id = null,
      kind = "pair_chat", // delegation | team_meeting | pair_chat | desk_review
      topic = "Interacción",
      hostAgentId = null,
      engagedDurationMs = null,
      rescueAfterMs = null,
      allowPreempt = false,
      participants = [],
    } = {},
    handlers = {},
  ) {
    if (!Array.isArray(participants) || participants.length < 2) {
      return null;
    }

    const barrierId = id || `barrier_${++this.barrierSeq}_${kind}`;
    const existing = this.barriers.get(barrierId);

    // Si ya existe una barrera de delegación activa con este ID, incorporar al nuevo subagente
    // regresando la barrera a APPROACHING para esperar su llegada y reiniciar el reloj ENGAGED.
    if (existing && existing.kind === "delegation") {
      return this._addParticipantsToBarrier(
        existing,
        participants,
        { topic, allowPreempt },
        handlers,
      );
    }

    // Exclusión mutua: verificar si algún participante pertenece a otra barrera activa
    const conflictingIds = new Set();
    for (const p of participants) {
      const current = this.getAgentBarrier(p.agentId);
      if (current && current.id !== barrierId) {
        if (!allowPreempt) {
          return null;
        }
        conflictingIds.add(current.id);
      }
    }

    for (const conflictId of conflictingIds) {
      this.cancelBarrier(
        conflictId,
        { returnHome: false, reason: "preempted" },
        handlers,
      );
    }

    const resolvedEngagedMs =
      typeof engagedDurationMs === "number" && engagedDurationMs > 0
        ? engagedDurationMs
        : kind === "delegation"
          ? this.meetingHoldMs
          : this._pickSocialDurationMs();

    const barrier = {
      id: barrierId,
      kind,
      topic: topic || "Interacción",
      hostAgentId: hostAgentId || participants[0]?.agentId || null,
      phase: "APPROACHING", // APPROACHING | ENGAGED | DISPERSING | CANCELLED
      participants: new Map(),
      approachStartedAt: this.simTimeMs,
      rescueAfterMs:
        typeof rescueAfterMs === "number" && rescueAfterMs > 0
          ? rescueAfterMs
          : this.approachRescueMs,
      engagedDurationMs: resolvedEngagedMs,
      engagedStartedAt: null,
      engagedUntil: null,
      turnStepMs: this.dialogueTurnMs,
      lastTurnBucket: -1,
      activeSpeakerIndex: 0,
    };

    const newlyAdded = [];
    for (const p of participants) {
      if (!p?.agentId) continue;
      barrier.participants.set(p.agentId, {
        agentId: p.agentId,
        role: p.role || (p.agentId === barrier.hostAgentId ? "host" : "participant"),
        checkpointId: p.checkpointId || null,
        actionKey: p.actionKey || null,
        waitingActionKey: p.waitingActionKey || null,
        socialMode: p.socialMode || null,
        partnerName: p.partnerName || null,
        overrideRotY: p.overrideRotY ?? null,
        seatedRequired: Boolean(p.seatedRequired),
        ready: false,
        rescued: false,
      });

      this.agentBarrierMap.set(p.agentId, barrier.id);
      const entry = this._ensureAgent(p.agentId);
      entry.activeBarrierId = barrier.id;
      entry.phase = "barrier_approaching";
      entry.meetingSeated = false;
      entry.deskSeated = false;
      entry.deskWorkStartedAt = null;
      if (kind === "delegation") {
        entry.activeLiveSession = true;
        entry.pendingCompletion = null;
      }
      newlyAdded.push(p.agentId);
    }

    if (barrier.participants.size < 2) {
      for (const idToClean of newlyAdded) {
        this.agentBarrierMap.delete(idToClean);
      }
      return null;
    }

    this.barriers.set(barrier.id, barrier);
    this._syncMeetingMirror(barrier);

    return {
      barrier,
      isNew: true,
      revertedToApproaching: false,
      newlyAdded,
    };
  }

  _addParticipantsToBarrier(
    barrier,
    participants = [],
    { topic = null, allowPreempt = true } = {},
    handlers = {},
  ) {
    const newlyAdded = [];
    let addedAnyNew = false;

    for (const p of participants) {
      if (!p?.agentId) continue;
      const otherBarrier = this.getAgentBarrier(p.agentId);
      if (otherBarrier && otherBarrier.id !== barrier.id) {
        if (!allowPreempt) continue;
        this.cancelBarrier(
          otherBarrier.id,
          { returnHome: false, reason: "preempted_by_delegation" },
          handlers,
        );
      }

      if (!barrier.participants.has(p.agentId)) {
        addedAnyNew = true;
        newlyAdded.push(p.agentId);
        barrier.participants.set(p.agentId, {
          agentId: p.agentId,
          role: p.role || (p.agentId === barrier.hostAgentId ? "host" : "participant"),
          checkpointId: p.checkpointId || null,
          actionKey: p.actionKey || null,
          waitingActionKey: p.waitingActionKey || null,
          socialMode: p.socialMode || null,
          partnerName: p.partnerName || null,
          overrideRotY: p.overrideRotY ?? null,
          seatedRequired: Boolean(p.seatedRequired),
          ready: false,
          rescued: false,
        });
      }

      this.agentBarrierMap.set(p.agentId, barrier.id);
      const entry = this._ensureAgent(p.agentId);
      entry.activeBarrierId = barrier.id;
      entry.deskSeated = false;
      entry.deskWorkStartedAt = null;
      if (barrier.kind === "delegation") {
        entry.activeLiveSession = true;
        entry.pendingCompletion = null;
      }
    }

    if (topic) {
      barrier.topic = topic;
    }

    let revertedToApproaching = false;
    if (addedAnyNew) {
      // Si se sumó un nuevo subagente, esperar su llegada y reiniciar la ventana ENGAGED
      revertedToApproaching = barrier.phase === "ENGAGED";
      barrier.phase = "APPROACHING";
      barrier.approachStartedAt = this.simTimeMs;
      barrier.engagedStartedAt = null;
      barrier.engagedUntil = null;
      barrier.lastTurnBucket = -1;

      for (const p of barrier.participants.values()) {
        const entry = this._ensureAgent(p.agentId);
        entry.phase = "barrier_approaching";
      }

      if (revertedToApproaching) {
        handlers.onBarrierRevertedToApproaching?.(barrier, newlyAdded);
      }
    }

    this._syncMeetingMirror(barrier);

    return {
      barrier,
      isNew: false,
      revertedToApproaching,
      newlyAdded,
    };
  }

  _enterEngagedPhase(barrier, handlers = {}) {
    if (!barrier || barrier.phase === "CANCELLED" || barrier.phase === "DISPERSING") {
      return;
    }
    barrier.phase = "ENGAGED";
    barrier.engagedStartedAt = this.simTimeMs;
    barrier.engagedUntil = this.simTimeMs + barrier.engagedDurationMs;
    barrier.lastTurnBucket = 0;
    barrier.activeSpeakerIndex = 0;

    for (const p of barrier.participants.values()) {
      const entry = this._ensureAgent(p.agentId);
      entry.phase = "barrier_engaged";
    }

    this._syncMeetingMirror(barrier);
    handlers.onBarrierEngaged?.(barrier);
  }

  markBarrierParticipantReady(agentId, handlers = {}) {
    const barrier = this.getAgentBarrier(agentId);
    if (!barrier || barrier.phase === "CANCELLED" || barrier.phase === "DISPERSING") {
      return null;
    }

    const participant = barrier.participants.get(agentId);
    if (!participant) return null;

    participant.ready = true;
    const entry = this._ensureAgent(agentId);
    if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
      entry.meetingSeated = true;
    }

    const allReady = Array.from(barrier.participants.values()).every(
      (p) => p.ready,
    );

    this._syncMeetingMirror(barrier);

    if (!allReady) {
      if (barrier.phase === "APPROACHING") {
        handlers.onBarrierParticipantWaiting?.(barrier, participant);
      }
      return { ready: true, allReady: false, barrier };
    }

    if (barrier.phase === "APPROACHING") {
      this._enterEngagedPhase(barrier, handlers);
    }

    return { ready: true, allReady: true, barrier };
  }

  cancelBarrier(
    barrierId,
    { returnHome = false, reason = "cancelled", excludeAgentIds = [] } = {},
    handlers = {},
  ) {
    const barrier = this.barriers.get(barrierId);
    if (!barrier) return false;

    barrier.phase = "CANCELLED";
    this.barriers.delete(barrierId);

    for (const id of barrier.participants.keys()) {
      this.agentBarrierMap.delete(id);
      const entry = this._ensureAgent(id);
      entry.activeBarrierId = null;
      entry.meetingSeated = false;
      if (entry.phase === "barrier_approaching" || entry.phase === "barrier_engaged") {
        entry.phase = entry.activeLiveSession ? "walk_to_desk" : "idle";
      }
    }

    if (this.meeting?.barrierId === barrierId) {
      this.meeting = null;
    }

    handlers.onBarrierCancelled?.(barrier, {
      returnHome,
      reason,
      excludeAgentIds: new Set(excludeAgentIds),
    });

    return true;
  }

  cancelBarrierForAgent(
    agentId,
    { returnHome = true, reason = "agent_interrupted", excludeAgentIds = [] } = {},
    handlers = {},
  ) {
    const barrier = this.getAgentBarrier(agentId);
    if (!barrier) return false;
    return this.cancelBarrier(
      barrier.id,
      { returnHome, reason, excludeAgentIds },
      handlers,
    );
  }

  _coalesceStep(entry, rawStep) {
    const step = {
      phase: rawStep.phase === "thinking" ? "thinking" : "working",
      label:
        rawStep.label ||
        (rawStep.phase === "thinking" ? "Pensando..." : "Trabajando..."),
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

  startDelegation(
    {
      hostAgentId = "architect",
      subagentId = null,
      topic = "Delegando subtarea",
      hostCheckpointId = "meeting-presenter",
      subagentCheckpointId = "meeting-chair-n1",
    } = {},
    handlers = {},
  ) {
    if (!hostAgentId || !subagentId || hostAgentId === subagentId) {
      return null;
    }

    const res = this.startBarrier(
      {
        id: "delegation_meeting",
        kind: "delegation",
        topic,
        hostAgentId,
        engagedDurationMs: this.meetingHoldMs,
        rescueAfterMs: this.approachRescueMs,
        allowPreempt: true,
        participants: [
          {
            agentId: hostAgentId,
            role: "host",
            checkpointId: hostCheckpointId,
            actionKey: "presenting",
            waitingActionKey: "standingIdle",
            socialMode: "MEETING",
            seatedRequired: false,
          },
          {
            agentId: subagentId,
            role: "participant",
            checkpointId: subagentCheckpointId,
            actionKey: "listening",
            waitingActionKey: "sittingIdle",
            socialMode: "MEETING",
            seatedRequired: true,
          },
        ],
      },
      handlers,
    );

    if (!res) return null;

    return {
      isNewMeeting: res.isNew,
      revertedToApproaching: res.revertedToApproaching,
      hostAgentId,
      subagentId,
      participants: Array.from(res.barrier.participants.keys()),
      newlyAdded: res.newlyAdded,
    };
  }

  markMeetingSeated(agentId, handlers = {}) {
    return Boolean(this.markBarrierParticipantReady(agentId, handlers));
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
      !entry.activeLiveSession ||
      entry.phase === "completed" ||
      entry.phase === "idle";

    entry.activeLiveSession = true;
    entry.pendingCompletion = null;

    // 1. Si participa en cualquier Barrera de Encuentro (APPROACHING o ENGAGED),
    //    retener en cola los bursts SSE sin interrumpir la reunión ni encender su monitor.
    if (this.hasActiveBarrier(agentId)) {
      this._coalesceStep(entry, { phase, label, file, toolName });
      handlers.onQueueDuringBarrier?.(agentId, { phase, label, file });
      handlers.onQueueDuringMeeting?.(agentId, { phase, label, file });
      return "queued_barrier";
    }

    // 2. Compuerta SEATED_READY: si está caminando al escritorio o aún no completó standToSit
    //    en su propia silla, retener acciones en cola sin encender monitor ni burbuja de trabajo.
    if (!isPhysicallyAtDesk || entry.phase === "walk_to_desk" || !entry.deskSeated) {
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

    // 3. Ya alcanzó SEATED_READY en su escritorio
    if (
      startingFreshRun ||
      !entry.deskSeated ||
      entry.deskWorkStartedAt === null
    ) {
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

    // Bloqueos urgentes (permiso CLI, pregunta interactiva, error fatal):
    // cancelar limpiamente la barrera activa para todos los participantes antes de resolver.
    if (urgent) {
      if (this.hasActiveBarrier(agentId)) {
        this.cancelBarrierForAgent(
          agentId,
          {
            returnHome: true,
            reason: "urgent_interrupt",
            excludeAgentIds: [agentId],
          },
          handlers,
        );
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

    // 1. Si sigue en barrera (APPROACHING o ENGAGED), diferir cierre hasta concluir reunión + retorno + 4s en escritorio
    if (this.hasActiveBarrier(agentId)) {
      entry.pendingCompletion = completion;
      return "deferred_barrier";
    }

    // 2. Si aún no está sentado físicamente en su escritorio, asegurar llegada y estancia mínima de 4s
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

    // 3. Ya está sentado: respetar cola pendiente y permanencia mínima de 4s
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
    // Compuerta estricta: si la barrera aún está activa, jamás abrir trabajo de escritorio
    if (this.hasActiveBarrier(agentId)) {
      return null;
    }

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

    if (entry.pendingCompletion && firstStep.label === "Tarea finalizada") {
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

    // 1. Actualizar todas las Barreras de Encuentro (APPROACHING -> ENGAGED -> DISPERSING)
    for (const barrier of Array.from(this.barriers.values())) {
      if (barrier.phase === "APPROACHING") {
        const approachElapsed = this.simTimeMs - barrier.approachStartedAt;
        if (approachElapsed >= barrier.rescueAfterMs) {
          for (const p of barrier.participants.values()) {
            if (!p.ready) {
              p.rescued = true;
              p.ready = true;
              const entry = this._ensureAgent(p.agentId);
              if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
                entry.meetingSeated = true;
              }
              handlers.onBarrierRescueParticipant?.(barrier, p);
            }
          }
          const allReadyNow = Array.from(barrier.participants.values()).every(
            (p) => p.ready,
          );
          if (allReadyNow) {
            this._enterEngagedPhase(barrier, handlers);
          }
        }
        continue;
      }

      if (barrier.phase === "ENGAGED") {
        const engagedElapsed =
          this.simTimeMs - (barrier.engagedStartedAt ?? this.simTimeMs);
        const turnBucket = Math.floor(engagedElapsed / barrier.turnStepMs);
        if (turnBucket > barrier.lastTurnBucket && barrier.participants.size > 0) {
          barrier.lastTurnBucket = turnBucket;
          barrier.activeSpeakerIndex = turnBucket % barrier.participants.size;
          handlers.onBarrierDialogueTurn?.(barrier, barrier.activeSpeakerIndex);
        }

        if (
          barrier.engagedUntil !== null &&
          this.simTimeMs >= barrier.engagedUntil
        ) {
          barrier.phase = "DISPERSING";
          this.barriers.delete(barrier.id);
          if (this.meeting?.barrierId === barrier.id) {
            this.meeting = null;
          }

          const dispatched = [];
          for (const [id, p] of barrier.participants.entries()) {
            this.agentBarrierMap.delete(id);
            const entry = this._ensureAgent(id);
            entry.activeBarrierId = null;
            entry.meetingSeated = false;
            entry.deskSeated = false;
            entry.deskWorkStartedAt = null;

            const hasLiveWork =
              entry.activeLiveSession ||
              entry.pendingBursts.length > 0 ||
              Boolean(entry.pendingCompletion);

            if (hasLiveWork) {
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
              dispatched.push({
                agentId: id,
                participant: p,
                hasLiveWork: true,
                step: nextInfo,
              });
            } else {
              entry.phase = "idle";
              dispatched.push({
                agentId: id,
                participant: p,
                hasLiveWork: false,
                step: null,
              });
            }
          }

          handlers.onBarrierDispersing?.(barrier, dispatched);
          if (barrier.kind === "delegation") {
            handlers.onDispatchFromMeeting?.(
              dispatched
                .filter((d) => d.hasLiveWork)
                .map((d) => ({ agentId: d.agentId, step: d.step })),
            );
          }
        }
      }
    }

    // 2. Avanzar ráfagas coalescidas y liberar cierres tras >= 4s en SEATED_READY
    for (const entry of this.agents.values()) {
      if (this.hasActiveBarrier(entry.agentId)) continue;
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

      if (entry.pendingCompletion && entry.pendingBursts.length === 0) {
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

  clearAgent(agentId, handlers = {}) {
    if (this.hasActiveBarrier(agentId)) {
      this.cancelBarrierForAgent(
        agentId,
        { returnHome: true, reason: "agent_cleared", excludeAgentIds: [agentId] },
        handlers,
      );
    }
    this.agents.delete(agentId);
    this.agentBarrierMap.delete(agentId);
  }

  reset() {
    this.agents.clear();
    this.barriers.clear();
    this.agentBarrierMap.clear();
    this.meeting = null;
  }
}
