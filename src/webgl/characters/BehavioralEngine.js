import { checkpointManager } from "../interaction/CheckpointManager.js";

/**
 * Perfiles de personalidad y preferencias conductuales por especialista.
 */
const AGENT_PERSONALITIES = {
  architect: {
    caffeineDecayRate: 2.3,
    fatigueGainRate: 1.7,
    socialDecayRate: 2.0,
    drinkPreferences: [
      { checkpointId: "kitchen-drip-coffee", action: "makeCoffee", weight: 1.3 },
      { checkpointId: "kitchen-espresso", action: "makeCoffee", weight: 1.15 },
      { checkpointId: "kitchen-water-cooler", action: "drinkWater", weight: 0.9 },
    ],
    focusBreaks: [
      { checkpointId: "meeting-whiteboard-spot", action: "writeWhiteboard", weight: 1.35 },
      { checkpointId: "supervisor-bookcase", action: "browseBooks", weight: 1.2 },
    ],
    restPreferences: [
      { checkpointId: "lounge-armchair-ne", action: "sittingTalking", weight: 1.15 },
      { checkpointId: "lounge-sofa-s1", action: "watchTV", weight: 1.05 },
    ],
    isReviewer: true,
  },
  backend: {
    caffeineDecayRate: 2.8,
    fatigueGainRate: 2.1,
    socialDecayRate: 1.65,
    drinkPreferences: [
      { checkpointId: "kitchen-espresso", action: "makeCoffee", weight: 1.55 },
      { checkpointId: "kitchen-drip-coffee", action: "makeCoffee", weight: 1.2 },
      { checkpointId: "barstool-1", action: "drinkCoffee", weight: 1.0 },
    ],
    focusBreaks: [
      { checkpointId: "pingpong-trophy-case", action: "inspectTrophies", weight: 0.95 },
    ],
    restPreferences: [
      { checkpointId: "lounge-sofa-s1", action: "watchTV", weight: 1.25 },
      { checkpointId: "arcade-machine", action: "playArcade", weight: 1.15 },
    ],
    isReviewer: false,
  },
  frontend: {
    caffeineDecayRate: 2.4,
    fatigueGainRate: 1.9,
    socialDecayRate: 2.25,
    drinkPreferences: [
      { checkpointId: "kitchen-water-cooler", action: "drinkWater", weight: 1.45 },
      { checkpointId: "vending-drinks", action: "buyVending", weight: 1.35 },
      { checkpointId: "kitchen-fridge", action: "openFridge", weight: 1.15 },
    ],
    focusBreaks: [
      { checkpointId: "meeting-whiteboard-spot", action: "writeWhiteboard", weight: 1.05 },
    ],
    restPreferences: [
      { checkpointId: "lounge-puff-orange", action: "textingSeated", weight: 1.35 },
      { checkpointId: "lounge-sofa-s2", action: "textingSeated", weight: 1.2 },
      { checkpointId: "arcade-machine", action: "playArcade", weight: 1.1 },
    ],
    isReviewer: false,
  },
  systems: {
    caffeineDecayRate: 2.9,
    fatigueGainRate: 2.15,
    socialDecayRate: 1.55,
    drinkPreferences: [
      { checkpointId: "kitchen-espresso", action: "makeCoffee", weight: 1.6 },
      { checkpointId: "vending-drinks", action: "buyVending", weight: 1.15 },
      { checkpointId: "kitchen-drip-coffee", action: "makeCoffee", weight: 1.1 },
    ],
    focusBreaks: [
      { checkpointId: "pingpong-whiteboard", action: "viewTournament", weight: 1.0 },
    ],
    restPreferences: [
      { checkpointId: "arcade-machine", action: "playArcade", weight: 1.35 },
      { checkpointId: "lounge-sofa-s1", action: "watchTV", weight: 1.15 },
    ],
    isReviewer: false,
  },
  qa: {
    caffeineDecayRate: 2.5,
    fatigueGainRate: 1.95,
    socialDecayRate: 2.1,
    drinkPreferences: [
      { checkpointId: "kitchen-water-cooler", action: "drinkWater", weight: 1.55 },
      { checkpointId: "kitchen-drip-coffee", action: "makeCoffee", weight: 1.15 },
      { checkpointId: "kitchen-fridge", action: "openFridge", weight: 1.05 },
    ],
    focusBreaks: [
      { checkpointId: "pingpong-whiteboard", action: "viewTournament", weight: 1.25 },
      { checkpointId: "supervisor-bookcase", action: "browseBooks", weight: 1.1 },
    ],
    restPreferences: [
      { checkpointId: "lounge-sofa-s2", action: "textingSeated", weight: 1.15 },
      { checkpointId: "lounge-armchair-ne", action: "sittingTalking", weight: 1.1 },
    ],
    isReviewer: true,
  },
};

export const SOCIAL_CHAT_TOPICS = [
  { badge: "☕", label: "Pausa de café" },
  { badge: "💡", label: "Idea de arquitectura" },
  { badge: "🌿", label: "Sincronizando rama Git" },
  { badge: "🐛", label: "Comentando fix reciente" },
];

export class BehavioralEngine {
  constructor(characterManager, propPersistence = null) {
    this.characterManager = characterManager;
    this.propPersistence = propPersistence;
    this.needs = new Map();

    // Inicializar necesidades desincronizadas con semillas distintas por agente
    const agents = this.characterManager?.characters || [];
    agents.forEach((agent, index) => {
      const id = agent.config.id;
      const seed = (index + 1) * 0.43;
      this.needs.set(id, {
        agentId: id,
        fatigue: 22 + ((index * 14) % 42), // 0..100 (alto = cansado)
        hydration: 54 + ((index * 17) % 36), // 0..100 (bajo = sed/cafeína baja)
        social: 48 + ((index * 19) % 38), // 0..100 (bajo = busca interacción social)
        mood: "focused", // "focused" | "happy" | "stressed" | "tired"
        moodLockUntil: 0,
        consecutiveTools: 0,
        evalTimer: 0.4 + (seed % 1.8), // Evaluación cada ~2.0s desincronizada
      });
    });
  }

  getAgentNeeds(agentId) {
    return this.needs.get(agentId) || null;
  }

  getAllNeedsSnapshot() {
    const out = {};
    for (const [id, st] of this.needs.entries()) {
      out[id] = {
        fatigue: Math.round(st.fatigue),
        hydration: Math.round(st.hydration),
        social: Math.round(st.social),
        mood: st.mood,
      };
    }
    return out;
  }

  /**
   * Registra eventos reales o simulados de OpenCode / GitHub para modular
   * el estado de ánimo (mood), fatiga y micro-reacciones emocionales.
   */
  recordTaskEvent(agentId, { type = "tool", status = "running" } = {}) {
    const st = this.needs.get(agentId);
    if (!st) return;

    const now = Date.now();
    if (type === "tool") {
      st.consecutiveTools += 1;
      st.fatigue = Math.min(100, st.fatigue + 3.2);
      st.hydration = Math.max(0, st.hydration - 2.4);
      if (status === "error") {
        st.mood = "stressed";
        st.moodLockUntil = now + 18000;
      }
      return;
    }

    if (status === "passed" || status === "success") {
      st.mood = "happy";
      st.moodLockUntil = now + 20000;
      st.consecutiveTools = 0;
      st.social = Math.max(0, st.social - 8); // Ganas de compartir logro
    } else if (status === "failed" || status === "error") {
      st.mood = "stressed";
      st.moodLockUntil = now + 22000;
      st.fatigue = Math.min(100, st.fatigue + 8);
    } else if (status === "started" || status === "working") {
      if (now >= st.moodLockUntil) {
        st.mood = "focused";
      }
    }
  }

  /**
   * Actualiza las necesidades continuas por segundo y evalúa el Motor de Utilidad
   * cada 2 segundos por agente libre.
   */
  update(delta, director) {
    if (!this.characterManager || !director) return;
    const now = Date.now();
    const minutesDelta = delta / 60;

    for (const agent of this.characterManager.characters) {
      const id = agent.config.id;
      const st = this.needs.get(id);
      const personality = AGENT_PERSONALITIES[id] || AGENT_PERSONALITIES.backend;
      if (!st) continue;

      // 1. Evolución continua de variables internas (0 a 100)
      const isWorking = agent.state === "WORKING" || agent.state === "THINKING";
      const isSocializing = Boolean(agent.socialMode);
      const isResting =
        agent.state === "INTERACTING" &&
        /lounge|arcade|barstool|pingpong/.test(String(agent.currentCheckpointId || ""));

      if (isWorking) {
        st.fatigue = Math.min(100, st.fatigue + personality.fatigueGainRate * minutesDelta * 12);
        st.hydration = Math.max(
          0,
          st.hydration - personality.caffeineDecayRate * minutesDelta * 14,
        );
        st.social = Math.max(0, st.social - personality.socialDecayRate * minutesDelta * 13);
      } else if (isResting) {
        st.fatigue = Math.max(10, st.fatigue - 28 * minutesDelta);
      }

      if (isSocializing) {
        st.social = Math.min(100, st.social + 36 * minutesDelta);
      }

      if (
        agent.state === "INTERACTING" &&
        /espresso|drip-coffee|water-cooler|fridge|vending/.test(
          String(agent.currentCheckpointId || ""),
        )
      ) {
        st.hydration = Math.min(100, st.hydration + 45 * minutesDelta);
      }

      // Actualizar mood automático cuando expira bloqueo de evento
      if (now >= st.moodLockUntil) {
        if (st.fatigue >= 76) {
          st.mood = "tired";
        } else {
          st.mood = "focused";
        }
      }

      // Sincronizar mood con el avatar para micro-posturas y burbuja
      if (agent.mood !== st.mood) {
        agent.mood = st.mood;
      }

      // 2. Evaluación del Motor de Utilidad cada 2.0s (solo si no tiene tarea real activa)
      st.evalTimer -= delta;
      if (st.evalTimer <= 0) {
        st.evalTimer = 1.9 + Math.random() * 0.35;
      }
    }
  }

  /**
   * Selecciona la mejor acción autónoma para un agente libre usando puntuación de Utilidad (Utility AI).
   * Retorna `true` si despachó una acción, `false` si decide seguir trabajando concentrado.
   */
  evaluateAndAct(agent, director) {
    if (!agent || !director) return false;
    const id = agent.config.id;
    const st = this.needs.get(id);
    const personality = AGENT_PERSONALITIES[id] || AGENT_PERSONALITIES.backend;
    if (!st || director.isAgentBusyForAmbient(id)) return false;

    const candidates = [];

    // Opción 0: Si tiene taza vacía sobre su escritorio y el fregadero está libre, ir a enjuagarla
    if (
      this.propPersistence?.hasEmptyMugOnDesk(id) &&
      checkpointManager.isAvailable("kitchen-sink")
    ) {
      candidates.push({
        kind: "rinse_empty_mug",
        score: 74 + Math.random() * 14,
      });
    }

    // Opción 1: Si tiene taza con café/agua en su escritorio, hacer micro-pausa de sorbo
    if (
      agent.isPhysicallyAtDesk() &&
      this.propPersistence?.hasDrinkReadyToSip(id)
    ) {
      const sipScore = (100 - st.hydration) * 0.85 + 24 + Math.random() * 12;
      candidates.push({
        kind: "desk_sip",
        score: sipScore,
      });
    }

    // Opción 2: Hidratación / Cafeína en cocina o expendedora según personalidad
    if (!this.propPersistence?.hasDrinkReadyToSip(id)) {
      const thirstUrgency = Math.max(0, 100 - st.hydration);
      for (const pref of personality.drinkPreferences) {
        if (checkpointManager.isAvailable(pref.checkpointId)) {
          candidates.push({
            kind: "station",
            checkpointId: pref.checkpointId,
            action: pref.action,
            score: thirstUrgency * pref.weight * 0.92 + Math.random() * 14,
            onPicked: () => {
              st.hydration = Math.min(100, st.hydration + 48);
            },
          });
        }
      }
    }

    // Opción 3: Fatiga alta (> 75 prioritario, o moderada) -> estiramiento o descanso en Lounge
    if (st.fatigue > 45) {
      const fatigueUrgency = st.fatigue > 75 ? st.fatigue * 1.35 : st.fatigue * 0.82;
      if (agent.isPhysicallyAtDesk()) {
        candidates.push({
          kind: "desk_stretch",
          score: fatigueUrgency * 0.78 + Math.random() * 12,
          onPicked: () => {
            st.fatigue = Math.max(15, st.fatigue - 22);
          },
        });
      }
      for (const rest of personality.restPreferences) {
        if (checkpointManager.isAvailable(rest.checkpointId)) {
          candidates.push({
            kind: "station",
            checkpointId: rest.checkpointId,
            action: rest.action,
            score: fatigueUrgency * rest.weight + Math.random() * 14,
            onPicked: () => {
              st.fatigue = Math.max(10, st.fatigue - 42);
            },
          });
        }
      }
    }

    // Opción 4: Necesidad Social -> Charla espontánea en pareja, Peer Review en escritorio o Ping-Pong
    const socialNeed = Math.max(0, 100 - st.social);
    const freePeers = this.characterManager.characters.filter(
      (other) =>
        other.config.id !== id &&
        !director.isAgentBusyForAmbient(other.config.id) &&
        (other.state === "WORKING" || other.state === "IDLE"),
    );

    if (freePeers.length > 0 && socialNeed > 35) {
      // A) Peer Review físico en escritorio (QA o Architect visitan a un dev sentado)
      if (personality.isReviewer && !director.isOpenCodeConnected) {
        const seatedDevs = freePeers.filter(
          (p) =>
            p.isPhysicallyAtDesk() &&
            (p.config.id === "backend" ||
              p.config.id === "frontend" ||
              p.config.id === "systems"),
        );
        if (seatedDevs.length > 0) {
          const targetHost =
            seatedDevs[Math.floor(Math.random() * seatedDevs.length)];
          candidates.push({
            kind: "peer_review",
            hostId: targetHost.config.id,
            reviewerId: id,
            score: socialNeed * 1.15 + Math.random() * 15,
            onPicked: () => {
              st.social = Math.min(100, st.social + 38);
            },
          });
        }
      }

      // B) Charla espontánea en cocina o lounge con otro agente con social bajo
      const mostSocialHungryPeer = freePeers
        .slice()
        .sort(
          (a, b) =>
            (this.needs.get(a.config.id)?.social ?? 50) -
            (this.needs.get(b.config.id)?.social ?? 50),
        )[0];

      if (mostSocialHungryPeer) {
        candidates.push({
          kind: "pair_chat",
          partnerId: mostSocialHungryPeer.config.id,
          score: socialNeed * 1.08 + Math.random() * 16,
          onPicked: () => {
            st.social = Math.min(100, st.social + 44);
            const peerSt = this.needs.get(mostSocialHungryPeer.config.id);
            if (peerSt) peerSt.social = Math.min(100, peerSt.social + 44);
          },
        });
      }

      // C) Partido interactivo de Ping-Pong
      if (
        checkpointManager.isAvailable("pingpong-player-north") &&
        checkpointManager.isAvailable("pingpong-player-south")
      ) {
        candidates.push({
          kind: "ping_pong",
          score: (socialNeed * 0.65 + st.fatigue * 0.45) + Math.random() * 14,
          onPicked: () => {
            st.social = Math.min(100, st.social + 42);
            st.fatigue = Math.max(15, st.fatigue - 28);
          },
        });
      }
    }

    // Opción 5: Curiosidad / Pausa de enfoque (pizarra, librería)
    for (const fb of personality.focusBreaks) {
      if (checkpointManager.isAvailable(fb.checkpointId)) {
        candidates.push({
          kind: "station",
          checkpointId: fb.checkpointId,
          action: fb.action,
          score: 36 * fb.weight + Math.random() * 18,
          onPicked: () => {
            st.fatigue = Math.max(20, st.fatigue - 16);
          },
        });
      }
    }

    if (candidates.length === 0) return false;

    // Ordenar de mayor a menor utilidad
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Umbral mínimo de utilidad para abandonar la concentración en el escritorio
    if (best.score < 42) return false;

    if (best.kind === "rinse_empty_mug") {
      return Boolean(this.propPersistence?.beginCarryEmptyMugToSink(id, director));
    }

    if (best.kind === "desk_sip") {
      const ok = this.propPersistence?.triggerDeskSip(id);
      if (ok) {
        st.hydration = Math.min(100, st.hydration + 18);
        return true;
      }
    }

    if (best.kind === "desk_stretch") {
      best.onPicked?.();
      agent.applyActionProfile("stretchBreak");
      agent.scheduleTimer(() => {
        if (
          agent.currentActionKey === "stretchBreak" &&
          agent.isPhysicallyAtDesk() &&
          !director.isAgentLiveBusy(id)
        ) {
          agent.applyActionProfile("typing", {
            customLabel: director.isOpenCodeConnected ? "Disponible" : "Tecleando código",
          });
        }
      }, 5000);
      return true;
    }

    if (best.kind === "peer_review") {
      const ok = director.triggerDeskReview(
        best.hostId,
        best.reviewerId,
        "Peer Review · Arquitectura & QA",
      );
      if (ok) {
        best.onPicked?.();
        return true;
      }
    }

    if (best.kind === "pair_chat") {
      const ok = director.triggerPairChat(id, best.partnerId);
      if (ok) {
        best.onPicked?.();
        return true;
      }
    }

    if (best.kind === "ping_pong") {
      const ok = director.triggerPingPongMatch();
      if (ok) {
        best.onPicked?.();
        return true;
      }
    }

    if (best.kind === "station") {
      const ok = director.sendAgentTo(id, best.checkpointId, best.action);
      if (ok) {
        best.onPicked?.();
        return true;
      }
    }

    return false;
  }
}
