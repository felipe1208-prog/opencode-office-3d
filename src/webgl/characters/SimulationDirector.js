import { checkpointManager } from "../interaction/CheckpointManager.js";
import { officeEventBus, OFFICE_EVENTS } from "../../events/OfficeEventBus.js";
import { VisualActionQueue } from "./VisualActionQueue.js";

const SOLO_DESTINATIONS = [
  { checkpointId: "kitchen-espresso", action: "makeCoffee" },
  { checkpointId: "kitchen-drip-coffee", action: "makeCoffee" },
  { checkpointId: "kitchen-water-cooler", action: "drinkWater" },
  { checkpointId: "kitchen-fridge", action: "openFridge" },
  { checkpointId: "barstool-1", action: "drinkCoffee" },
  { checkpointId: "barstool-2", action: "drinkCoffee" },
  { checkpointId: "lounge-sofa-s1", action: "watchTV" },
  { checkpointId: "lounge-sofa-s2", action: "texting" },
  { checkpointId: "lounge-armchair-ne", action: "sittingTalking" },
  { checkpointId: "lounge-puff-orange", action: "texting" },
  { checkpointId: "arcade-machine", action: "playArcade" },
  { checkpointId: "vending-snacks", action: "buyVending" },
  { checkpointId: "vending-drinks", action: "buyVending" },
  { checkpointId: "pingpong-whiteboard", action: "viewTournament" },
  { checkpointId: "supervisor-bookcase", action: "browseBooks" },
];

const PAIR_CHAT_VENUES = [
  {
    venue: "coffee",
    spots: [
      { checkpointId: "kitchen-espresso", action: "pairChat", rotY: -0.35 },
      { checkpointId: "kitchen-drip-coffee", action: "pairChat", rotY: -Math.PI + 0.35 },
    ],
  },
  {
    venue: "coffee",
    spots: [
      { checkpointId: "barstool-1", action: "pairChatSeated", rotY: -Math.PI / 2 - 0.32 },
      { checkpointId: "barstool-2", action: "pairChatSeated", rotY: -Math.PI / 2 + 0.32 },
    ],
  },
  {
    venue: "lounge",
    spots: [
      { checkpointId: "lounge-sofa-w1", action: "pairChatSeated", rotY: Math.PI / 2 },
      { checkpointId: "lounge-armchair-ne", action: "pairChatSeated", rotY: -Math.PI / 2 },
    ],
  },
  {
    venue: "lounge",
    spots: [
      { checkpointId: "lounge-sofa-w2", action: "pairChatSeated", rotY: Math.PI / 2 },
      { checkpointId: "lounge-armchair-se", action: "pairChatSeated", rotY: -Math.PI / 2 },
    ],
  },
];

const REVIEW_CHECKPOINT_BY_HOST = {
  architect: "review-architect",
  frontend: "review-frontend",
  qa: "review-qa",
  backend: "review-backend",
  systems: "review-systems",
};

const MEETING_SEATS = [
  "meeting-chair-n1",
  "meeting-chair-s1",
  "meeting-chair-n2",
  "meeting-chair-s2",
  "meeting-chair-n3",
  "meeting-chair-s3",
];

const SAMPLE_TASKS = [
  { label: "Compilando grafo A*", file: "src/webgl/navigation/Pathfinding.ts" },
  { label: "Optimizando shaders PBR", file: "src/webgl/core/Renderer.ts" },
  { label: "Validando pruebas NavMesh", file: "tests/nav-graph.spec.ts" },
  { label: "Sincronizando Event Bus", file: "src/events/OfficeEventBus.ts" },
  { label: "Hook OpenCode en espera", file: "cli/opencode-adapter.ts" },
];

export class SimulationDirector {
  constructor(
    characterManager,
    { onDirectorChange = null, monitorSystem = null } = {},
  ) {
    this.characterManager = characterManager;
    this.onDirectorChange = onDirectorChange;
    this.monitorSystem = monitorSystem;

    this.paused = false;
    this.speedMultiplier = 1; // 1 | 1.5 | 2
    this.agentTimers = new Map();
    this.liveOwnership = new Map(); // agentId -> { active: boolean, idleCooldown: number }
    this.activeDelegation = null; // { hostAgentId, participants: Set }
    this._lastOpenCodeStatus = null;
    this.visualQueue = new VisualActionQueue({
      meetingHoldMs: 5000,
      meetingExtendMs: 5000,
      socialHoldMinMs: 12000,
      socialHoldMaxMs: 15000,
      approachRescueMs: 14000,
      deskDwellMs: 4000,
      stepDisplayMs: 950,
      dialogueTurnMs: 2200,
    });
    this.unsubscribers = [];
    this.queueHandlers = this._getQueueHandlers();

    this.initTimers();
    this.bindEventBus();
  }

  initTimers() {
    for (const agent of this.characterManager.characters) {
      this.agentTimers.set(agent.config.id, {
        workCooldown: 9 + Math.random() * 11,
        interactCooldown: 0,
        waitCooldown: 0,
      });
    }
  }

  isAgentLiveBusy(agentId) {
    const live = this.liveOwnership.get(agentId);
    return Boolean(
      (live && (live.active || live.idleCooldown > 0)) ||
        this.visualQueue.hasActiveChoreography(agentId),
    );
  }

  isAgentBusyForAmbient(agentId) {
    return (
      this.isAgentLiveBusy(agentId) ||
      this.visualQueue.hasActiveBarrier(agentId)
    );
  }

  _isAgentPhysicallyAtDesk(agent) {
    if (!agent) return false;
    return (
      agent.currentCheckpointId === agent.homeCheckpointId &&
      agent.isSeated &&
      !agent.isTransitioningSeat &&
      agent.state !== "TRAVELING"
    );
  }

  _sendBarrierParticipantToCheckpoint(barrier, participant) {
    const agent = this.characterManager.getAgent(participant.agentId);
    if (!agent) return false;

    const timer = this.agentTimers.get(participant.agentId);
    if (timer) {
      timer.interactCooldown = 20;
      timer.waitCooldown = 20;
    }

    const onSeated = () => {
      this.visualQueue.markBarrierParticipantReady(
        participant.agentId,
        this.queueHandlers,
      );
    };

    if (
      barrier.kind === "desk_review" &&
      participant.role === "host" &&
      this._isAgentPhysicallyAtDesk(agent)
    ) {
      agent.setSocialContext({
        mode: participant.socialMode,
        phase: "APPROACHING",
        partnerName: participant.partnerName,
        rotY: participant.overrideRotY,
      });
      onSeated();
      return true;
    }

    const isMeetingBarrier =
      barrier.kind === "delegation" || barrier.kind === "team_meeting";
    const isMeetingHost = participant.role === "host" && isMeetingBarrier;

    if (isMeetingHost) {
      const currentCp = checkpointManager.get(participant.checkpointId);
      const prevHolderId = currentCp?.reservedBy;
      if (
        prevHolderId &&
        prevHolderId !== participant.agentId &&
        !barrier.participants.has(prevHolderId)
      ) {
        const prevAgent = this.characterManager.getAgent(prevHolderId);
        if (
          prevAgent &&
          (prevAgent.currentCheckpointId === participant.checkpointId ||
            prevAgent.targetCheckpointId === participant.checkpointId)
        ) {
          prevAgent.returnHome();
        }
      }
    }

    const initialAction =
      barrier.kind === "desk_review" && participant.role === "host"
        ? "typing"
        : participant.waitingActionKey || "standingIdle";

    return agent.requestAction(participant.checkpointId, {
      overrideAction: initialAction,
      socialMode: participant.socialMode,
      socialPhase: "APPROACHING",
      socialPartnerName: participant.partnerName,
      overrideRotY: participant.overrideRotY,
      forceReserve: isMeetingHost,
      moveSpeed: barrier.kind === "delegation" ? 2.35 : null,
      onSeated,
    });
  }

  _applyBarrierMutualOrientation(barrier) {
    const list = Array.from(barrier.participants.values());
    if (barrier.kind === "pair_chat" && list.length === 2) {
      const a1 = this.characterManager.getAgent(list[0].agentId);
      const a2 = this.characterManager.getAgent(list[1].agentId);
      if (a1 && a2) {
        a1.lookAtWorldPosition(a2.model.position);
        a2.lookAtWorldPosition(a1.model.position);
      }
      return;
    }

    if (barrier.kind === "desk_review" && list.length === 2) {
      const hostP = list.find((p) => p.role === "host") || list[0];
      const revP = list.find((p) => p !== hostP) || list[1];
      const hostAgent = this.characterManager.getAgent(hostP.agentId);
      const revAgent = this.characterManager.getAgent(revP.agentId);
      if (hostAgent && revAgent) {
        revAgent.lookAtWorldPosition(hostAgent.model.position);
      }
      return;
    }

    if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
      const hostP = list.find((p) => p.role === "host") || list[0];
      const hostAgent = this.characterManager.getAgent(hostP?.agentId);
      if (hostAgent) {
        const firstListener = list.find((p) => p.agentId !== hostP.agentId);
        const listenerAgent = firstListener
          ? this.characterManager.getAgent(firstListener.agentId)
          : null;
        if (listenerAgent) {
          hostAgent.lookAtWorldPosition(listenerAgent.model.position);
        }
      }
    }
  }

  _applyBarrierTurnClips(barrier, speakerIndex = 0) {
    const list = Array.from(barrier.participants.values());
    if (list.length === 0) return;

    const activeIdx = speakerIndex % list.length;

    list.forEach((p, idx) => {
      const agent = this.characterManager.getAgent(p.agentId);
      if (!agent) return;
      const isSpeaker = idx === activeIdx;

      if (barrier.kind === "pair_chat") {
        const action = isSpeaker
          ? p.actionKey || (p.seatedRequired ? "pairChatSeated" : "pairChat")
          : p.waitingActionKey || (p.seatedRequired ? "sittingIdle" : "standingIdle");
        agent.applyActionProfile(action);
        return;
      }

      if (barrier.kind === "desk_review") {
        if (p.role === "host") {
          agent.applyActionProfile(isSpeaker ? "sittingTalking" : "sittingIdle", {
            customLabel: `Revisando · ${p.partnerName || barrier.topic}`,
          });
        } else {
          agent.applyActionProfile(isSpeaker ? "deskReview" : "talking", {
            customLabel: `Revisando · ${p.partnerName || barrier.topic}`,
          });
        }
        return;
      }

      if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
        if (p.role === "host") {
          const action = isSpeaker ? "presenting" : "talking";
          agent.applyActionProfile(action, {
            customLabel: barrier.topic,
          });
        } else {
          const action = isSpeaker ? "listening" : "sittingIdle";
          agent.applyActionProfile(action, {
            customLabel: barrier.topic,
          });
        }
      }
    });
  }

  _getQueueHandlers() {
    return {
      onQueueDuringBarrier: () => {
        // Retener burbujas SSE y monitores estrictamente hasta SEATED_READY;
        // la bitácora en Comando ya refleja el stream en vivo.
      },

      onBarrierParticipantWaiting: (barrier, participant) => {
        const agent = this.characterManager.getAgent(participant.agentId);
        if (!agent) return;

        const partners = Array.from(barrier.participants.values()).filter(
          (p) => p.agentId !== participant.agentId,
        );
        const firstPartnerAgent = partners[0]
          ? this.characterManager.getAgent(partners[0].agentId)
          : null;

        agent.setSocialContext({
          mode: participant.socialMode,
          phase: "APPROACHING",
          partnerName: participant.partnerName,
          rotY: participant.overrideRotY,
        });

        if (barrier.kind === "desk_review" && participant.role === "host") {
          agent.applyActionProfile("typing", {
            customLabel: `Esperando revisión · ${participant.partnerName || "Compañero"}`,
          });
        } else {
          const waitAction =
            participant.waitingActionKey ||
            (participant.seatedRequired ? "sittingIdle" : "standingIdle");
          agent.applyActionProfile(waitAction);
        }

        if (
          (barrier.kind === "delegation" || barrier.kind === "team_meeting") &&
          participant.role !== "host"
        ) {
          const presenterPos = checkpointManager.get("meeting-presenter")?.pos;
          if (presenterPos) {
            agent.lookAtWorldPosition(presenterPos);
          }
        } else if (
          firstPartnerAgent &&
          !(barrier.kind === "desk_review" && participant.role === "host")
        ) {
          const partnerTarget =
            firstPartnerAgent.model?.position ||
            checkpointManager.get(partners[0].checkpointId)?.pos;
          if (partnerTarget) {
            agent.lookAtWorldPosition(partnerTarget);
          }
        }
      },

      onBarrierRevertedToApproaching: (barrier) => {
        const hostAgent = this.characterManager.getAgent(barrier.hostAgentId);
        if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
          this.monitorSystem?.setMeetingState({
            active: true,
            topic: `Esperando equipo · ${String(barrier.topic || "").slice(0, 26)}`,
            presenterName: hostAgent?.config.name || "Tech Lead",
          });
        }

        for (const p of barrier.participants.values()) {
          if (!p.ready) continue;
          const agent = this.characterManager.getAgent(p.agentId);
          if (!agent) continue;
          agent.setSocialContext({
            mode: p.socialMode,
            phase: "APPROACHING",
            partnerName: p.partnerName,
            rotY: p.overrideRotY,
          });
          agent.applyActionProfile(
            p.waitingActionKey || (p.seatedRequired ? "sittingIdle" : "standingIdle"),
          );
        }
      },

      onBarrierRescueParticipant: (barrier, participant) => {
        const agent = this.characterManager.getAgent(participant.agentId);
        const cp = checkpointManager.get(participant.checkpointId);
        if (!agent || !cp) return;

        const rescueAction =
          barrier.kind === "desk_review" && participant.role === "host"
            ? "typing"
            : participant.waitingActionKey ||
              (participant.seatedRequired ? "sittingIdle" : "standingIdle");

        agent.snapToCheckpointAndSit(cp, {
          overrideAction: rescueAction,
          socialMode: participant.socialMode,
          socialPhase: "APPROACHING",
          socialPartnerName: participant.partnerName,
          overrideRotY: participant.overrideRotY,
        });
      },

      onBarrierEngaged: (barrier) => {
        const safeTopic = String(barrier.topic || "Sincronización").slice(0, 38);
        const hostAgent = this.characterManager.getAgent(barrier.hostAgentId);

        for (const p of barrier.participants.values()) {
          const agent = this.characterManager.getAgent(p.agentId);
          if (!agent) continue;
          if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
            agent.taskTitle = safeTopic;
          }
          agent.setSocialContext({
            mode: p.socialMode,
            phase: "ENGAGED",
            partnerName: p.partnerName,
            rotY: p.overrideRotY,
          });
        }

        this._applyBarrierMutualOrientation(barrier);
        this._applyBarrierTurnClips(barrier, 0);

        if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
          this.monitorSystem?.setMeetingState({
            active: true,
            topic:
              barrier.kind === "delegation"
                ? `Delegación · ${safeTopic}`
                : safeTopic,
            presenterName: hostAgent?.config.name || "Tech Lead",
          });
        } else if (barrier.kind === "desk_review") {
          const list = Array.from(barrier.participants.values());
          const hostP = list.find((p) => p.role === "host") || list[0];
          const revP = list.find((p) => p !== hostP) || list[1];
          const revAgent = revP ? this.characterManager.getAgent(revP.agentId) : null;
          if (hostP) {
            this.monitorSystem?.setAgentScreenState(hostP.agentId, {
              mode: "REVIEWING",
              taskLabel: barrier.topic,
              partnerName: revAgent?.config.name || revP?.partnerName || "Compañero",
            });
          }
        }
      },

      onBarrierDialogueTurn: (barrier, speakerIndex) => {
        this._applyBarrierTurnClips(barrier, speakerIndex);
      },

      onBarrierDispersing: (barrier, dispatchedList) => {
        if (barrier.kind === "delegation") {
          this.activeDelegation = null;
        }
        if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
          this.monitorSystem?.setMeetingState({ active: false });
        }

        for (const { agentId, participant, hasLiveWork, step } of dispatchedList) {
          const agent = this.characterManager.getAgent(agentId);
          if (!agent) continue;

          const returnSpeed = barrier.kind === "delegation" ? 1.85 : null;

          if (hasLiveWork && step) {
            agent.returnHome({
              moveSpeed: returnSpeed,
              pendingLiveTask: {
                status: "started",
                phase: step.phase,
                label: step.label,
                accentColor: step.phase === "thinking" ? "#4F6EF7" : null,
                onSeated: () => {
                  const applied = this.visualQueue.markDeskSeated(agentId);
                  if (!applied) return;
                  const finalLabel =
                    applied.burstCount > 1
                      ? `${applied.label} (×${applied.burstCount})`
                      : applied.label;
                  const finalMode =
                    applied.phase === "thinking" ? "THINKING" : "WORKING";
                  agent.state = finalMode;
                  agent.taskTitle = finalLabel;
                  agent.currentActionLabel = finalLabel;
                  agent.taskAccentColor =
                    finalMode === "THINKING" ? "#4F6EF7" : null;
                  agent.syncBubble();
                  agent.notifyStateChange();
                  this.monitorSystem?.setAgentScreenState(agentId, {
                    mode: finalMode,
                    taskLabel: finalLabel || agent.currentActionLabel,
                    taskFile: applied.file,
                  });
                },
              },
            });
          } else {
            const timer = this.agentTimers.get(agentId);
            if (timer) {
              timer.workCooldown = 12 + Math.random() * 8;
              timer.interactCooldown = 0;
              timer.waitCooldown = 0;
            }

            if (
              barrier.kind === "desk_review" &&
              participant.role === "host" &&
              this._isAgentPhysicallyAtDesk(agent)
            ) {
              agent.clearSocialContext();
              agent.applyActionProfile("typing");
              this.monitorSystem?.setAgentScreenState(agentId, {
                mode: "WORKING",
                taskLabel: "Tecleando código",
                partnerName: null,
              });
            } else {
              agent.returnHome({ moveSpeed: returnSpeed });
            }
          }
        }
      },

      onBarrierCancelled: (barrier, { returnHome = true, excludeAgentIds = new Set() } = {}) => {
        if (barrier.kind === "delegation") {
          this.activeDelegation = null;
        }
        if (barrier.kind === "delegation" || barrier.kind === "team_meeting") {
          this.monitorSystem?.setMeetingState({ active: false });
        }

        for (const agentId of barrier.participants.keys()) {
          if (excludeAgentIds.has(agentId)) continue;
          const agent = this.characterManager.getAgent(agentId);
          if (!agent) continue;
          agent.clearSocialContext();

          const timer = this.agentTimers.get(agentId);
          if (timer) {
            timer.interactCooldown = 0;
            timer.waitCooldown = 0;
            timer.workCooldown = 10 + Math.random() * 6;
          }

          if (!returnHome) continue;

          const entry = this.visualQueue.getAgentState(agentId);
          const hasLive = Boolean(
            entry &&
              (entry.activeLiveSession ||
                entry.pendingBursts.length > 0 ||
                entry.pendingCompletion),
          );

          if (hasLive) {
            agent.returnHome({
              pendingLiveTask: {
                status: "started",
                phase: "working",
                label: entry.pendingBursts[0]?.label || "Ejecutando subtarea",
                onSeated: () => {
                  const applied = this.visualQueue.markDeskSeated(agentId);
                  if (!applied) return;
                  const finalLabel =
                    applied.burstCount > 1
                      ? `${applied.label} (×${applied.burstCount})`
                      : applied.label;
                  const finalMode =
                    applied.phase === "thinking" ? "THINKING" : "WORKING";
                  agent.state = finalMode;
                  agent.taskTitle = finalLabel;
                  agent.currentActionLabel = finalLabel;
                  agent.taskAccentColor =
                    finalMode === "THINKING" ? "#4F6EF7" : null;
                  agent.syncBubble();
                  agent.notifyStateChange();
                  this.monitorSystem?.setAgentScreenState(agentId, {
                    mode: finalMode,
                    taskLabel: finalLabel || agent.currentActionLabel,
                    taskFile: applied.file,
                  });
                },
              },
            });
          } else if (this._isAgentPhysicallyAtDesk(agent)) {
            agent.applyActionProfile("typing");
            this.monitorSystem?.setAgentScreenState(agentId, {
              mode: "WORKING",
              taskLabel: "Tecleando código",
              partnerName: null,
            });
          } else {
            agent.returnHome();
          }
        }
      },

      onStartWalkToDesk: (agentId, { phase = "working", label, file }) => {
        const agent = this.characterManager.getAgent(agentId);
        if (!agent) return;

        agent.returnHome({
          pendingLiveTask: {
            status: "started",
            phase,
            label,
            accentColor: phase === "thinking" ? "#4F6EF7" : null,
            onSeated: () => {
              const applied = this.visualQueue.markDeskSeated(agentId);
              if (!applied) return;
              const finalLabel =
                applied.burstCount > 1
                  ? `${applied.label} (×${applied.burstCount})`
                  : applied.label;
              const finalMode =
                applied.phase === "thinking" ? "THINKING" : "WORKING";
              agent.state = finalMode;
              agent.taskTitle = finalLabel;
              agent.currentActionLabel = finalLabel;
              agent.taskAccentColor =
                finalMode === "THINKING" ? "#4F6EF7" : null;
              agent.syncBubble();
              agent.notifyStateChange();
              this.monitorSystem?.setAgentScreenState(agentId, {
                mode: finalMode,
                taskLabel: finalLabel || agent.currentActionLabel,
                taskFile: applied.file,
              });
            },
          },
        });
      },

      onApplyDeskStep: (agentId, step) => {
        const agent = this.characterManager.getAgent(agentId);
        if (!agent) return;
        const screenMode = step.phase === "thinking" ? "THINKING" : "WORKING";
        const displayLabel =
          step.burstCount > 1
            ? `${step.label} (×${step.burstCount})`
            : step.label;
        agent.applyTaskFeedback({
          status: "started",
          phase: step.phase,
          label: displayLabel,
          onSeated: () => {
            this.monitorSystem?.setAgentScreenState(agentId, {
              mode: screenMode,
              taskLabel: displayLabel || agent.currentActionLabel,
              taskFile: step.file,
            });
          },
        });
      },

      onApplyCompletion: (agentId, completion) => {
        const agent = this.characterManager.getAgent(agentId);
        if (!agent) return;
        const cooldown = Math.max(4, Number(completion.idleCooldownSec) || 15);
        this.liveOwnership.set(agentId, {
          active: false,
          idleCooldown: cooldown,
        });
        const screenMode = completion.status === "failed" ? "ERROR" : "SUCCESS";
        agent.applyTaskFeedback({
          status: completion.status,
          label: completion.label,
          onSeated: () => {
            this.monitorSystem?.setAgentScreenState(agentId, {
              mode: screenMode,
              taskLabel: completion.label || agent.currentActionLabel,
              taskFile: completion.file,
            });
          },
        });
      },
    };
  }

  _clearDelegationHuddle({ returnRemainingHome = false } = {}) {
    if (this.visualQueue.getBarrier("delegation_meeting")) {
      this.visualQueue.cancelBarrier(
        "delegation_meeting",
        { returnHome: returnRemainingHome, reason: "clear_delegation" },
        this.queueHandlers,
      );
      return;
    }
    this.activeDelegation = null;
    this.monitorSystem?.setMeetingState({ active: false });
  }

  _executeDelegationHuddle({
    hostAgentId = "architect",
    subagentId = null,
    topic = "Delegando subtarea",
    active = true,
  } = {}) {
    if (!active) {
      this._clearDelegationHuddle({ returnRemainingHome: true });
      return false;
    }

    const host = this.characterManager.getAgent(hostAgentId);
    const subagent = subagentId ? this.characterManager.getAgent(subagentId) : null;
    if (!host || !subagent || host.config.id === subagent.config.id) {
      return false;
    }

    const existingDelegation = this.visualQueue.getBarrier("delegation_meeting");
    const usedSeats = new Set();
    if (existingDelegation) {
      for (const p of existingDelegation.participants.values()) {
        if (p.checkpointId) usedSeats.add(p.checkpointId);
      }
    }

    const existingSubSeat = existingDelegation?.participants.get(subagent.config.id)?.checkpointId;
    const subSeat =
      existingSubSeat ||
      MEETING_SEATS.find(
        (s) => !usedSeats.has(s) && checkpointManager.isAvailable(s),
      ) ||
      MEETING_SEATS.find((s) => !usedSeats.has(s)) ||
      MEETING_SEATS[0];

    const hostFirst = host.config.name.split(" ")[0];
    const subFirst = subagent.config.name.split(" ")[0];

    const delegation = this.visualQueue.startDelegation(
      {
        hostAgentId: host.config.id,
        subagentId: subagent.config.id,
        hostName: hostFirst,
        subagentName: subFirst,
        topic,
        hostCheckpointId: "meeting-presenter",
        subagentCheckpointId: subSeat,
      },
      this.queueHandlers,
    );
    if (!delegation) return false;

    const barrier = this.visualQueue.getBarrier("delegation_meeting");
    if (!this.activeDelegation) {
      this.activeDelegation = {
        hostAgentId: host.config.id,
        participants: new Set(delegation.participants),
      };
    } else {
      for (const id of delegation.participants) {
        this.activeDelegation.participants.add(id);
      }
    }

    this.liveOwnership.set(host.config.id, { active: true, idleCooldown: 0 });
    this.liveOwnership.set(subagent.config.id, { active: true, idleCooldown: 0 });

    const safeTopic = String(topic || `Delegando @${subagent.config.id}`).slice(0, 38);
    if (barrier?.phase === "APPROACHING") {
      this.monitorSystem?.setMeetingState({
        active: true,
        topic: `Esperando equipo · ${safeTopic}`,
        presenterName: host.config.name,
      });
    }

    if (barrier) {
      if (barrier.participants.size > 2) {
        const hostP = barrier.participants.get(host.config.id);
        if (hostP) hostP.partnerName = "Equipo";
      }

      const newlyAddedSet = new Set(delegation.newlyAdded || []);
      for (const [id, participant] of barrier.participants.entries()) {
        const pAgent = this.characterManager.getAgent(id);
        if (!pAgent) continue;

        const isAtAssignedSpot =
          pAgent.currentCheckpointId === participant.checkpointId &&
          !pAgent.isTransitioningSeat &&
          pAgent.state !== "TRAVELING";
        const isHeadingToAssignedSpot =
          pAgent.state === "TRAVELING" &&
          pAgent.targetCheckpointId === participant.checkpointId;

        // Enviar obligatoriamente a todo recién incorporado y a cualquiera (especialmente host)
        // que no esté físicamente en su puesto asignado ni caminando hacia él.
        if (newlyAddedSet.has(id) || (!isAtAssignedSpot && !isHeadingToAssignedSpot)) {
          participant.ready = false;
          this._sendBarrierParticipantToCheckpoint(barrier, participant);
        }
      }
    }

    return true;
  }

  claimAgentForLiveTask(
    agentId,
    {
      status = "started",
      phase = "working",
      label = null,
      file = null,
    } = {},
  ) {
    const agent = this.characterManager.getAgent(agentId);
    if (!agent) return false;

    this.liveOwnership.set(agentId, {
      active: true,
      idleCooldown: 0,
    });

    const timer = this.agentTimers.get(agentId);
    if (timer) {
      timer.workCooldown = 16;
      timer.interactCooldown = 0;
      timer.waitCooldown = 0;
    }

    this.visualQueue.enqueueWork(
      agentId,
      {
        status,
        phase,
        label: label || (phase === "thinking" ? "Pensando..." : "Trabajando en OpenCode"),
        file,
        isPhysicallyAtDesk: this._isAgentPhysicallyAtDesk(agent),
      },
      this.queueHandlers,
    );
    return true;
  }

  releaseAgentFromLiveTask(
    agentId,
    { status = "passed", label = null, file = null, idleCooldownSec = 15 } = {},
  ) {
    const agent = this.characterManager.getAgent(agentId);
    if (!agent) return false;

    const isUrgent =
      status === "failed" &&
      /permiso|respuesta en cli|fallo/i.test(String(label || ""));

    this.liveOwnership.set(agentId, {
      active: !isUrgent,
      idleCooldown: isUrgent ? Math.max(4, Number(idleCooldownSec) || 15) : 0,
    });

    this.visualQueue.enqueueCompletion(
      agentId,
      {
        status,
        label: label || (status === "failed" ? "Fallo detectado" : "Tarea finalizada"),
        file,
        idleCooldownSec,
        urgent: isUrgent,
        isPhysicallyAtDesk: this._isAgentPhysicallyAtDesk(agent),
      },
      this.queueHandlers,
    );
    return true;
  }

  clearAllLiveClaims() {
    this.liveOwnership.clear();
    this.visualQueue.reset();
    this.activeDelegation = null;
    this.monitorSystem?.setMeetingState({ active: false });
    for (const agent of this.characterManager?.characters || []) {
      agent?.setHasPendingUserQuestion?.(false);
      const keepCp = agent.currentCheckpointId || agent.targetCheckpointId || null;
      checkpointManager.releaseAllByAgent(agent.config.id, {
        exceptCheckpointId: keepCp,
      });
      if (
        agent.taskAccentColor === "#E11D48" ||
        /esperando|fallo|permiso/i.test(String(agent.currentActionLabel || "")) ||
        agent.pendingLiveTask
      ) {
        agent.applyTaskFeedback({
          status: "passed",
          label: "Disponible",
          onSeated: () => {
            agent.taskAccentColor = null;
            agent.setHasPendingUserQuestion?.(false);
            this.monitorSystem?.setAgentScreenState(agent.config.id, {
              mode: "WORKING",
              taskLabel: "En espera",
              taskFile: null,
            });
          },
        });
      }
    }
  }

  bindEventBus() {
    this.unsubscribers.push(
      officeEventBus.on(OFFICE_EVENTS.OPENCODE_CONNECTION, (payload) => {
        const nextStatus = payload?.status || null;
        if (
          nextStatus === "disconnected" &&
          this._lastOpenCodeStatus &&
          this._lastOpenCodeStatus !== "disconnected"
        ) {
          this.clearAllLiveClaims();
        }
        if (nextStatus) {
          this._lastOpenCodeStatus = nextStatus;
        }
      }),

      officeEventBus.on(OFFICE_EVENTS.OPENCODE_QUESTION, (payload) => {
        const attentionAgents = new Set();
        const entries = Array.isArray(payload)
          ? payload
          : (payload?.entries ?? payload?.questions ?? payload?.queue ?? []);
        for (const entry of Array.isArray(entries) ? entries : []) {
          if (entry?.agentId) attentionAgents.add(entry.agentId);
        }
        for (const q of Array.isArray(payload?.queue) ? payload.queue : []) {
          if (q?.agentId) attentionAgents.add(q.agentId);
        }
        for (const inq of Array.isArray(payload?.inquiries)
          ? payload.inquiries
          : []) {
          if (inq?.agentId) attentionAgents.add(inq.agentId);
        }
        for (const agent of this.characterManager?.characters || []) {
          const id = agent?.config?.id;
          if (id) {
            agent.setHasPendingUserQuestion?.(attentionAgents.has(id));
          }
        }
      }),

      officeEventBus.on(OFFICE_EVENTS.OPENCODE_DELEGATION, (payload) => {
        this._executeDelegationHuddle(payload);
      }),

      officeEventBus.on(OFFICE_EVENTS.AGENT_TASK, (payload) => {
        const agent = this.characterManager.getAgent(payload.agentId);
        if (!agent) return;

        if (payload.live) {
          if (payload.status === "started" || payload.status === "working") {
            this.claimAgentForLiveTask(payload.agentId, payload);
          } else {
            this.releaseAgentFromLiveTask(payload.agentId, payload);
          }
          return;
        }

        if (this.visualQueue.hasActiveBarrier(payload.agentId)) {
          return;
        }

        const timer = this.agentTimers.get(payload.agentId);
        if (timer) {
          timer.workCooldown = 14 + Math.random() * 6;
        }

        let screenMode = "WORKING";
        if (payload.status === "passed") screenMode = "SUCCESS";
        else if (payload.status === "failed") screenMode = "ERROR";

        agent.applyTaskFeedback({
          status: payload.status || "started",
          label: payload.label,
          onSeated: () => {
            this.monitorSystem?.setAgentScreenState(payload.agentId, {
              mode: screenMode,
              taskLabel: payload.label || agent.currentActionLabel,
              taskFile: payload.file,
            });
          },
        });
      }),

      officeEventBus.on(OFFICE_EVENTS.AGENT_NAVIGATE, (payload) => {
        if (!payload.agentId || !payload.checkpointId) return;
        this.sendAgentTo(
          payload.agentId,
          payload.checkpointId,
          payload.actionKey || null,
        );
      }),

      officeEventBus.on(OFFICE_EVENTS.SOCIAL_PAIR_CHAT, (payload) => {
        this._executePairChat(payload);
      }),

      officeEventBus.on(OFFICE_EVENTS.SOCIAL_DESK_REVIEW, (payload) => {
        this._executeDeskReview(payload);
      }),

      officeEventBus.on(OFFICE_EVENTS.OFFICE_MEETING, (payload) => {
        this._executeTeamMeeting(payload);
      }),
    );
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    this.emitDirectorState();
  }

  setSpeedMultiplier(speed) {
    this.speedMultiplier =
      speed === 2 || speed === 1.5 || speed === 1 ? speed : 1;
    this.emitDirectorState();
  }

  emitDirectorState() {
    if (this.onDirectorChange) {
      this.onDirectorChange({
        paused: this.paused,
        speedMultiplier: this.speedMultiplier,
      });
    }
  }

  sendAgentTo(
    agentId,
    checkpointId,
    overrideAction = null,
    { onSeated = null, internalBarrierMove = false } = {},
  ) {
    const agent = this.characterManager.getAgent(agentId);
    if (!agent) return false;

    if (!internalBarrierMove && this.visualQueue.hasActiveBarrier(agentId)) {
      this.visualQueue.cancelBarrierForAgent(
        agentId,
        {
          returnHome: true,
          reason: "manual_redirect",
          excludeAgentIds: [agentId],
        },
        this.queueHandlers,
      );
    }

    const timer = this.agentTimers.get(agentId);
    if (timer) {
      timer.interactCooldown = 9 + Math.random() * 6;
      timer.waitCooldown = 12 + Math.random() * 5;
    }

    if (!String(checkpointId).startsWith("meeting-")) {
      this.monitorSystem?.setMeetingState({ active: false });
    }
    return agent.requestAction(checkpointId, { overrideAction, onSeated });
  }

  forceAgentAnimation(agentId, actionKey) {
    const agent = this.characterManager.getAgent(agentId);
    if (!agent) return;

    if (this.visualQueue.hasActiveBarrier(agentId)) {
      this.visualQueue.cancelBarrierForAgent(
        agentId,
        {
          returnHome: true,
          reason: "forced_animation",
          excludeAgentIds: [agentId],
        },
        this.queueHandlers,
      );
    }

    const timer = this.agentTimers.get(agentId);
    if (timer) {
      timer.interactCooldown = 8;
      timer.workCooldown = 14;
    }

    agent.forcePreviewAction(actionKey);
  }

  triggerPingPongMatch() {
    const candidates = this.characterManager.characters.filter(
      (a) =>
        !this.isAgentBusyForAmbient(a.config.id) &&
        (a.state === "WORKING" || a.state === "IDLE"),
    );
    if (candidates.length < 2) return false;

    const northFree = checkpointManager.isAvailable("pingpong-player-north");
    const southFree = checkpointManager.isAvailable("pingpong-player-south");
    if (!northFree || !southFree) return false;

    this.sendAgentTo(
      candidates[0].config.id,
      "pingpong-player-north",
      "playPingPong",
    );
    this.sendAgentTo(
      candidates[1].config.id,
      "pingpong-player-south",
      "playPingPong",
    );
    return true;
  }

  triggerTeamMeeting(topic = "Sincronización de Sprint · Event Bus") {
    const entry = officeEventBus.emit(
      OFFICE_EVENTS.OFFICE_MEETING,
      { presenterId: "architect", topic },
      "director",
    );
    return Boolean(entry);
  }

  _executeTeamMeeting({ presenterId = "architect", topic } = {}) {
    const availableAgents = this.characterManager.characters.filter(
      (a) => !this.isAgentLiveBusy(a.config.id),
    );
    if (availableAgents.length < 2) return false;

    const presenter =
      availableAgents.find((a) => a.config.id === presenterId) ||
      availableAgents[0];
    const safeTopic = topic || "Sprint Sync · Oficina Virtual 3D";

    const participants = [
      {
        agentId: presenter.config.id,
        role: "host",
        checkpointId: "meeting-presenter",
        actionKey: "presenting",
        waitingActionKey: "standingIdle",
        socialMode: "MEETING",
        partnerName: "Equipo",
        seatedRequired: false,
      },
    ];

    let seatIndex = 0;
    for (const agent of availableAgents) {
      if (agent.config.id === presenter.config.id) continue;
      if (seatIndex >= MEETING_SEATS.length) break;
      const seatId = MEETING_SEATS[seatIndex++];
      participants.push({
        agentId: agent.config.id,
        role: "participant",
        checkpointId: seatId,
        actionKey: "listening",
        waitingActionKey: "sittingIdle",
        socialMode: "MEETING",
        partnerName: presenter.config.name.split(" ")[0],
        seatedRequired: true,
      });
    }

    const res = this.visualQueue.startBarrier(
      {
        id: "team_meeting",
        kind: "team_meeting",
        topic: safeTopic,
        hostAgentId: presenter.config.id,
        allowPreempt: true,
        participants,
      },
      this.queueHandlers,
    );
    if (!res) return false;

    this.monitorSystem?.setMeetingState({
      active: true,
      topic: `Esperando equipo · ${safeTopic}`,
      presenterName: presenter.config.name,
    });

    for (const p of res.barrier.participants.values()) {
      this._sendBarrierParticipantToCheckpoint(res.barrier, p);
    }
    return true;
  }

  triggerPairChat(agentAId = null, agentBId = null, preferredVenue = null) {
    const pool = this.characterManager.characters.filter(
      (a) =>
        !this.isAgentBusyForAmbient(a.config.id) &&
        (a.state === "WORKING" || a.state === "IDLE"),
    );
    const first =
      (agentAId &&
        !this.isAgentBusyForAmbient(agentAId) &&
        this.characterManager.getAgent(agentAId)) ||
      pool[0];
    const second =
      (agentBId &&
        !this.isAgentBusyForAmbient(agentBId) &&
        this.characterManager.getAgent(agentBId)) ||
      pool.find((a) => a.config.id !== first?.config.id);

    if (!first || !second || first.config.id === second.config.id) return false;

    const matchingVenues = PAIR_CHAT_VENUES.filter(
      (v) =>
        (!preferredVenue || v.venue === preferredVenue) &&
        checkpointManager.isAvailable(v.spots[0].checkpointId) &&
        checkpointManager.isAvailable(v.spots[1].checkpointId),
    );
    if (matchingVenues.length === 0) return false;

    const pick =
      matchingVenues[Math.floor(Math.random() * matchingVenues.length)];

    officeEventBus.emit(
      OFFICE_EVENTS.SOCIAL_PAIR_CHAT,
      {
        agentIds: [first.config.id, second.config.id],
        venue: pick.venue,
        spots: pick.spots,
      },
      "director",
    );
    return true;
  }

  _executePairChat({ agentIds = [], venue = "coffee", spots = null } = {}) {
    if (agentIds.length < 2) return false;
    const a1 = this.characterManager.getAgent(agentIds[0]);
    const a2 = this.characterManager.getAgent(agentIds[1]);
    if (!a1 || !a2 || a1.config.id === a2.config.id) return false;

    // Exclusión mutua estricta: nunca reclamar avatares en otra barrera o tarea live
    if (
      this.isAgentBusyForAmbient(a1.config.id) ||
      this.isAgentBusyForAmbient(a2.config.id)
    ) {
      return false;
    }

    const resolvedSpots =
      spots ||
      PAIR_CHAT_VENUES.find(
        (v) =>
          v.venue === venue &&
          checkpointManager.isAvailable(v.spots[0].checkpointId) &&
          checkpointManager.isAvailable(v.spots[1].checkpointId),
      )?.spots;

    if (!resolvedSpots) return false;

    const a1First = a1.config.name.split(" ")[0];
    const a2First = a2.config.name.split(" ")[0];
    const p1Seated = resolvedSpots[0].action === "pairChatSeated";
    const p2Seated = resolvedSpots[1].action === "pairChatSeated";

    const res = this.visualQueue.startBarrier(
      {
        kind: "pair_chat",
        topic: `Charla · ${a1First} & ${a2First}`,
        hostAgentId: a1.config.id,
        allowPreempt: false,
        participants: [
          {
            agentId: a1.config.id,
            role: "host",
            checkpointId: resolvedSpots[0].checkpointId,
            actionKey: resolvedSpots[0].action,
            waitingActionKey: p1Seated ? "sittingIdle" : "standingIdle",
            socialMode: "PAIR_CHAT",
            partnerName: a2First,
            overrideRotY: resolvedSpots[0].rotY,
            seatedRequired: p1Seated,
          },
          {
            agentId: a2.config.id,
            role: "participant",
            checkpointId: resolvedSpots[1].checkpointId,
            actionKey: resolvedSpots[1].action,
            waitingActionKey: p2Seated ? "sittingIdle" : "standingIdle",
            socialMode: "PAIR_CHAT",
            partnerName: a1First,
            overrideRotY: resolvedSpots[1].rotY,
            seatedRequired: p2Seated,
          },
        ],
      },
      this.queueHandlers,
    );
    if (!res) return false;

    for (const p of res.barrier.participants.values()) {
      this._sendBarrierParticipantToCheckpoint(res.barrier, p);
    }
    return true;
  }

  triggerDeskReview(hostAgentId = null, reviewerAgentId = null, topic = "Code Review") {
    const workingAtHome = this.characterManager.characters.filter(
      (a) =>
        !this.isAgentBusyForAmbient(a.config.id) &&
        a.state === "WORKING" &&
        a.currentCheckpointId === a.homeCheckpointId &&
        checkpointManager.isAvailable(REVIEW_CHECKPOINT_BY_HOST[a.config.id]),
    );

    const host =
      (hostAgentId &&
        !this.isAgentBusyForAmbient(hostAgentId) &&
        this.characterManager.getAgent(hostAgentId)) ||
      workingAtHome[0];
    if (!host) return false;

    const reviewCpId = REVIEW_CHECKPOINT_BY_HOST[host.config.id];
    if (!reviewCpId || !checkpointManager.isAvailable(reviewCpId)) return false;

    const reviewerCandidates = this.characterManager.characters.filter(
      (a) =>
        a.config.id !== host.config.id &&
        !this.isAgentBusyForAmbient(a.config.id) &&
        (a.state === "WORKING" || a.state === "IDLE"),
    );
    const reviewer =
      (reviewerAgentId &&
        !this.isAgentBusyForAmbient(reviewerAgentId) &&
        this.characterManager.getAgent(reviewerAgentId)) ||
      reviewerCandidates[
        Math.floor(Math.random() * reviewerCandidates.length)
      ];
    if (!reviewer || reviewer.config.id === host.config.id) return false;

    officeEventBus.emit(
      OFFICE_EVENTS.SOCIAL_DESK_REVIEW,
      {
        hostAgentId: host.config.id,
        reviewerAgentId: reviewer.config.id,
        topic,
      },
      "director",
    );
    return true;
  }

  _executeDeskReview({ hostAgentId, reviewerAgentId, topic = "Code Review" } = {}) {
    const host = this.characterManager.getAgent(hostAgentId);
    const reviewer = this.characterManager.getAgent(reviewerAgentId);
    const reviewCpId = REVIEW_CHECKPOINT_BY_HOST[hostAgentId];
    if (!host || !reviewer || !reviewCpId || host.config.id === reviewer.config.id) {
      return false;
    }

    if (
      this.isAgentBusyForAmbient(host.config.id) ||
      this.isAgentBusyForAmbient(reviewer.config.id)
    ) {
      return false;
    }

    const hostFirst = host.config.name.split(" ")[0];
    const reviewerFirst = reviewer.config.name.split(" ")[0];

    const res = this.visualQueue.startBarrier(
      {
        kind: "desk_review",
        topic,
        hostAgentId: host.config.id,
        allowPreempt: false,
        participants: [
          {
            agentId: host.config.id,
            role: "host",
            checkpointId: host.homeCheckpointId,
            actionKey: "sittingTalking",
            waitingActionKey: "typing",
            socialMode: "DESK_REVIEW",
            partnerName: reviewerFirst,
            seatedRequired: true,
          },
          {
            agentId: reviewer.config.id,
            role: "participant",
            checkpointId: reviewCpId,
            actionKey: "deskReview",
            waitingActionKey: "standingIdle",
            socialMode: "DESK_REVIEW",
            partnerName: hostFirst,
            seatedRequired: false,
          },
        ],
      },
      this.queueHandlers,
    );
    if (!res) return false;

    for (const p of res.barrier.participants.values()) {
      this._sendBarrierParticipantToCheckpoint(res.barrier, p);
    }
    return true;
  }

  returnAllHome() {
    this.visualQueue.reset();
    this.activeDelegation = null;
    this.monitorSystem?.setMeetingState({ active: false });
    for (const agent of this.characterManager.characters) {
      const timer = this.agentTimers.get(agent.config.id);
      if (timer) {
        timer.workCooldown = 12 + Math.random() * 8;
        timer.interactCooldown = 0;
        timer.waitCooldown = 0;
      }
      agent.returnHome();
    }
  }

  update(delta) {
    if (this.paused) return;

    const scaledDelta = delta * this.speedMultiplier;
    this.visualQueue.tick(scaledDelta * 1000, this.queueHandlers);

    for (const agent of this.characterManager.characters) {
      const agentId = agent.config.id;
      const timer = this.agentTimers.get(agentId);
      if (!timer) continue;

      // Exclusión mutua estricta: los temporizadores independientes nunca
      // interrumpen una barrera APPROACHING / ENGAGED ni la cola activa.
      if (this.visualQueue.hasActiveBarrier(agentId)) {
        continue;
      }

      const live = this.liveOwnership.get(agentId);
      if (live) {
        if (live.active) {
          continue;
        }
        if (live.idleCooldown > 0) {
          live.idleCooldown -= delta;
          if (live.idleCooldown > 0) continue;

          this.liveOwnership.delete(agentId);
          timer.workCooldown = 6 + Math.random() * 8;
        }
      }

      if (agent.state === "WORKING") {
        timer.workCooldown -= scaledDelta;
        if (timer.workCooldown <= 0) {
          if (agent.socialMode === "DESK_REVIEW") {
            agent.clearSocialContext();
            agent.applyActionProfile("typing");
            this.monitorSystem?.setAgentScreenState(agentId, {
              mode: "WORKING",
              taskLabel: "Tecleando código",
              partnerName: null,
            });
            timer.workCooldown = 12 + Math.random() * 8;
            continue;
          }

          const roll = Math.random();
          if (roll < 0.22) {
            const isSuccess = Math.random() < 0.65;
            const sample =
              SAMPLE_TASKS[Math.floor(Math.random() * SAMPLE_TASKS.length)];
            officeEventBus.emit(
              OFFICE_EVENTS.AGENT_TASK,
              {
                agentId,
                status: isSuccess ? "passed" : "failed",
                label: isSuccess ? sample.label : "Revisando traza de error",
                file: sample.file,
              },
              "mock-director",
            );
            timer.workCooldown = 11 + Math.random() * 7;
          } else if (roll < 0.4 && this.triggerPairChat(agentId)) {
            timer.workCooldown = 14 + Math.random() * 8;
          } else if (roll < 0.54 && this.triggerDeskReview(agentId)) {
            timer.workCooldown = 15 + Math.random() * 8;
          } else {
            const availablePool = SOLO_DESTINATIONS.filter((d) =>
              checkpointManager.isAvailable(d.checkpointId),
            );
            const pool =
              availablePool.length > 0 ? availablePool : SOLO_DESTINATIONS;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            this.sendAgentTo(agentId, pick.checkpointId, pick.action);
            timer.workCooldown = 12 + Math.random() * 8;
          }
        }
      } else if (agent.state === "INTERACTING") {
        timer.interactCooldown -= scaledDelta;
        if (timer.interactCooldown <= 0) {
          timer.workCooldown = 12 + Math.random() * 10;
          agent.returnHome();
        }
      } else if (agent.state === "WAITING") {
        timer.waitCooldown -= scaledDelta;
        if (timer.waitCooldown <= 0) {
          timer.workCooldown = 10 + Math.random() * 8;
          agent.abandonWaitingAndReturnHome();
        }
      }
    }
  }

  destroy() {
    this._clearDelegationHuddle({ returnRemainingHome: false });
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
