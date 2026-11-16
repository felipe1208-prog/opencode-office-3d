import { checkpointManager } from "../interaction/CheckpointManager.js";
import { officeEventBus, OFFICE_EVENTS } from "../../events/OfficeEventBus.js";

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
    this.speedMultiplier = 1; // 1 | 2
    this.agentTimers = new Map();
    this.unsubscribers = [];

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

  bindEventBus() {
    this.unsubscribers.push(
      officeEventBus.on(OFFICE_EVENTS.AGENT_TASK, (payload) => {
        const agent = this.characterManager.getAgent(payload.agentId);
        if (!agent) return;

        const timer = this.agentTimers.get(payload.agentId);
        if (timer) {
          timer.workCooldown = 14 + Math.random() * 6;
        }

        agent.applyTaskFeedback({
          status: payload.status || "started",
          label: payload.label,
        });

        let screenMode = "WORKING";
        if (payload.status === "passed") screenMode = "SUCCESS";
        else if (payload.status === "failed") screenMode = "ERROR";

        this.monitorSystem?.setAgentScreenState(payload.agentId, {
          mode: screenMode,
          taskLabel: payload.label || agent.currentActionLabel,
          taskFile: payload.file,
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
    this.speedMultiplier = speed === 2 ? 2 : 1;
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

  sendAgentTo(agentId, checkpointId, overrideAction = null) {
    const agent = this.characterManager.getAgent(agentId);
    if (!agent) return false;

    const timer = this.agentTimers.get(agentId);
    if (timer) {
      timer.interactCooldown = 9 + Math.random() * 6;
      timer.waitCooldown = 12 + Math.random() * 5;
    }

    this.monitorSystem?.setMeetingState({ active: false });
    return agent.requestAction(checkpointId, { overrideAction });
  }

  forceAgentAnimation(agentId, actionKey) {
    const agent = this.characterManager.getAgent(agentId);
    if (!agent) return;

    const timer = this.agentTimers.get(agentId);
    if (timer) {
      timer.interactCooldown = 8;
      timer.workCooldown = 14;
    }

    agent.forcePreviewAction(actionKey);
  }

  triggerPingPongMatch() {
    const candidates = this.characterManager.characters.filter(
      (a) => a.state === "WORKING" || a.state === "IDLE",
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
    const seats = [
      "meeting-chair-n1",
      "meeting-chair-s1",
      "meeting-chair-n2",
      "meeting-chair-s2",
      "meeting-chair-n3",
      "meeting-chair-s3",
    ];

    const agents = [...this.characterManager.characters];
    const presenter =
      agents.find((a) => a.config.id === presenterId) || agents[0];

    if (presenter) {
      this.sendAgentTo(presenter.config.id, "meeting-presenter", "presenting");
    }

    let seatIndex = 0;
    for (const agent of agents) {
      if (presenter && agent.config.id === presenter.config.id) continue;
      if (seatIndex >= seats.length) break;
      const seatId = seats[seatIndex++];
      this.sendAgentTo(agent.config.id, seatId, "listening");
    }

    this.monitorSystem?.setMeetingState({
      active: true,
      topic: topic || "Sprint Sync · Oficina Virtual 3D",
      presenterName: presenter?.config.name || "Tech Lead",
    });
    return true;
  }

  triggerPairChat(agentAId = null, agentBId = null, preferredVenue = null) {
    const pool = this.characterManager.characters.filter(
      (a) => a.state === "WORKING" || a.state === "IDLE",
    );
    const first =
      (agentAId && this.characterManager.getAgent(agentAId)) || pool[0];
    const second =
      (agentBId && this.characterManager.getAgent(agentBId)) ||
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
    if (!a1 || !a2) return false;

    const resolvedSpots =
      spots ||
      PAIR_CHAT_VENUES.find(
        (v) =>
          v.venue === venue &&
          checkpointManager.isAvailable(v.spots[0].checkpointId) &&
          checkpointManager.isAvailable(v.spots[1].checkpointId),
      )?.spots;

    if (!resolvedSpots) return false;

    const duration = 12 + Math.random() * 5;
    const t1 = this.agentTimers.get(a1.config.id);
    const t2 = this.agentTimers.get(a2.config.id);
    if (t1) t1.interactCooldown = duration;
    if (t2) t2.interactCooldown = duration;

    a1.requestAction(resolvedSpots[0].checkpointId, {
      overrideAction: resolvedSpots[0].action,
      socialMode: "PAIR_CHAT",
      socialPartnerName: a2.config.name.split(" ")[0],
      overrideRotY: resolvedSpots[0].rotY,
    });
    a2.requestAction(resolvedSpots[1].checkpointId, {
      overrideAction: resolvedSpots[1].action,
      socialMode: "PAIR_CHAT",
      socialPartnerName: a1.config.name.split(" ")[0],
      overrideRotY: resolvedSpots[1].rotY,
    });
    return true;
  }

  triggerDeskReview(hostAgentId = null, reviewerAgentId = null, topic = "Code Review") {
    const workingAtHome = this.characterManager.characters.filter(
      (a) =>
        a.state === "WORKING" &&
        a.currentCheckpointId === a.homeCheckpointId &&
        checkpointManager.isAvailable(REVIEW_CHECKPOINT_BY_HOST[a.config.id]),
    );

    const host =
      (hostAgentId && this.characterManager.getAgent(hostAgentId)) ||
      workingAtHome[0];
    if (!host) return false;

    const reviewCpId = REVIEW_CHECKPOINT_BY_HOST[host.config.id];
    if (!reviewCpId || !checkpointManager.isAvailable(reviewCpId)) return false;

    const reviewerCandidates = this.characterManager.characters.filter(
      (a) =>
        a.config.id !== host.config.id &&
        (a.state === "WORKING" || a.state === "IDLE"),
    );
    const reviewer =
      (reviewerAgentId && this.characterManager.getAgent(reviewerAgentId)) ||
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
    if (!host || !reviewer || !reviewCpId) return false;

    if (host.currentCheckpointId !== host.homeCheckpointId) {
      host.returnHome();
    }

    const duration = 13 + Math.random() * 4;
    const tHost = this.agentTimers.get(host.config.id);
    const tRev = this.agentTimers.get(reviewer.config.id);
    if (tHost) tHost.workCooldown = duration + 4;
    if (tRev) tRev.interactCooldown = duration;

    host.setSocialContext({
      mode: "DESK_REVIEW",
      partnerName: reviewer.config.name.split(" ")[0],
    });
    host.applyActionProfile("sittingTalking", {
      customLabel: `Revisión · ${topic}`,
    });

    this.monitorSystem?.setAgentScreenState(host.config.id, {
      mode: "REVIEWING",
      taskLabel: topic,
      partnerName: reviewer.config.name,
    });

    reviewer.requestAction(reviewCpId, {
      overrideAction: "deskReview",
      socialMode: "DESK_REVIEW",
      socialPartnerName: host.config.name.split(" ")[0],
    });

    return true;
  }

  returnAllHome() {
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

    for (const agent of this.characterManager.characters) {
      const timer = this.agentTimers.get(agent.config.id);
      if (!timer) continue;

      if (agent.state === "WORKING") {
        timer.workCooldown -= scaledDelta;
        if (timer.workCooldown <= 0) {
          // Si estaba en revisión colaborativa, devolver escritorio a estado normal
          if (agent.socialMode === "DESK_REVIEW") {
            agent.clearSocialContext();
            agent.applyActionProfile("typing");
            this.monitorSystem?.setAgentScreenState(agent.config.id, {
              mode: "WORKING",
              taskLabel: "Tecleando código",
              partnerName: null,
            });
            timer.workCooldown = 12 + Math.random() * 8;
            continue;
          }

          const roll = Math.random();
          if (roll < 0.22) {
            // Micro-reacción o tarea simulada vía Event Bus
            const isSuccess = Math.random() < 0.65;
            const sample =
              SAMPLE_TASKS[Math.floor(Math.random() * SAMPLE_TASKS.length)];
            officeEventBus.emit(
              OFFICE_EVENTS.AGENT_TASK,
              {
                agentId: agent.config.id,
                status: isSuccess ? "passed" : "failed",
                label: isSuccess ? sample.label : "Revisando traza de error",
                file: sample.file,
              },
              "mock-director",
            );
            timer.workCooldown = 11 + Math.random() * 7;
          } else if (roll < 0.4 && this.triggerPairChat(agent.config.id)) {
            timer.workCooldown = 14 + Math.random() * 8;
          } else if (roll < 0.54 && this.triggerDeskReview(agent.config.id)) {
            timer.workCooldown = 15 + Math.random() * 8;
          } else {
            const availablePool = SOLO_DESTINATIONS.filter((d) =>
              checkpointManager.isAvailable(d.checkpointId),
            );
            const pool =
              availablePool.length > 0 ? availablePool : SOLO_DESTINATIONS;
            const pick = pool[Math.floor(Math.random() * pool.length)];
            this.sendAgentTo(agent.config.id, pick.checkpointId, pick.action);
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
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }
}
