import { checkpointManager } from "../interaction/CheckpointManager.js";

const NEARBY_OBJECT_RADIUS = 2.5;
const NEARBY_PEER_RADIUS = 4.5;
const WHITEBOARD_VISIBLE_RADIUS = 3.2;
const SPATIAL_SYNC_INTERVAL_MS = 2000; // Chequeo ligero off-rAF (0.5 Hz)
const MIN_SYNC_INTERVAL_MS = 3500; // Mínimo entre envíos HTTP salvo force
const HEARTBEAT_SYNC_MS = 6000; // Heartbeat máximo en reposo
const MAX_PROCESSED_COMMANDS = 250;

export const OFFICE_PROPS_CATALOG = [
  // Oficina del Tech Lead
  {
    id: "desk-architect",
    label: "Escritorio del Tech Lead",
    type: "workstation",
    zoneId: "supervisor",
    x: -8.4,
    z: -5.65,
    state: "con monitor principal y portátil de coordinación",
  },
  {
    id: "supervisor-bookcase",
    label: "Librero de arquitectura",
    type: "storage",
    zoneId: "supervisor",
    x: -5.5,
    z: -7.9,
    state: "con manuales técnicos y referencias",
  },
  {
    id: "supervisor-guest-chairs",
    label: "Sillas de visita de dirección",
    type: "seating",
    zoneId: "supervisor",
    x: -8.4,
    z: -4.6,
    state: "disponibles frente al escritorio",
  },

  // Área de Desarrollo (Pod 2 + Pods auxiliares)
  {
    id: "desk-frontend",
    label: "Escritorio de Frontend Dev",
    type: "workstation",
    zoneId: "dev-area",
    x: -6.7,
    z: 4.8,
    state: "con monitores duales WebGL",
  },
  {
    id: "desk-qa",
    label: "Escritorio de DevOps / QA",
    type: "workstation",
    zoneId: "dev-area",
    x: -5.3,
    z: 4.8,
    state: "con monitores de pruebas",
  },
  {
    id: "desk-backend",
    label: "Escritorio de Backend Dev",
    type: "workstation",
    zoneId: "dev-area",
    x: -5.3,
    z: 5.6,
    state: "con monitores de API y datos",
  },
  {
    id: "desk-systems",
    label: "Escritorio de Systems Dev",
    type: "workstation",
    zoneId: "dev-area",
    x: -6.7,
    z: 5.6,
    state: "con terminal CLI y automatización",
  },
  {
    id: "dev-pod1",
    label: "Bancada oeste de desarrollo",
    type: "workstation",
    zoneId: "dev-area",
    x: -9.6,
    z: 5.2,
    state: "estaciones auxiliares",
  },
  {
    id: "dev-pod3",
    label: "Isla norte de desarrollo",
    type: "workstation",
    zoneId: "dev-area",
    x: -7.8,
    z: 1.0,
    state: "estación auxiliar norte",
  },

  // Sala de Reuniones
  {
    id: "meeting-whiteboard",
    label: "Pizarra de Arquitectura",
    type: "whiteboard",
    zoneId: "meeting-room",
    x: 1.85,
    z: -8.99,
    state: "pizarra compartida del equipo",
  },
  {
    id: "meeting-tv",
    label: "Pantalla de Sala de Reuniones",
    type: "screen",
    zoneId: "meeting-room",
    x: -1.8,
    z: -8.99,
    state: "display de sincronización",
  },
  {
    id: "meeting-table",
    label: "Mesa de conferencias",
    type: "meeting",
    zoneId: "meeting-room",
    x: 0.0,
    z: -6.0,
    state: "con portátiles y carpetas de proyecto",
  },

  // Cocina y Barra de Café
  {
    id: "coffee-espresso",
    label: "Cafetera espresso",
    type: "coffee",
    zoneId: "coffee-kitchen",
    x: -1.65,
    z: 6.45,
    state: "lista para preparar café",
  },
  {
    id: "coffee-drip",
    label: "Cafetera de filtro",
    type: "coffee",
    zoneId: "coffee-kitchen",
    x: -1.65,
    z: 5.75,
    state: "café recién hecho",
  },
  {
    id: "water-cooler",
    label: "Dispensador de agua",
    type: "coffee",
    zoneId: "coffee-kitchen",
    x: -1.55,
    z: 4.0,
    state: "agua fría y caliente",
  },
  {
    id: "kitchen-fridge",
    label: "Refrigerador",
    type: "coffee",
    zoneId: "coffee-kitchen",
    x: -1.6,
    z: 7.38,
    state: "bebidas y snacks",
  },
  {
    id: "coffee-bar",
    label: "Barra de café y taburetes",
    type: "coffee",
    zoneId: "coffee-kitchen",
    x: 0.3,
    z: 6.0,
    state: "zona de pausa y charla",
  },

  // Zona Ping-Pong y Arcade
  {
    id: "pingpong-table",
    label: "Mesa de ping-pong",
    type: "leisure",
    zoneId: "ping-pong",
    x: 7.5,
    z: -4.5,
    state: "lista para partido rápido",
  },
  {
    id: "arcade-machine",
    label: "Máquina arcade",
    type: "leisure",
    zoneId: "ping-pong",
    x: 6.2,
    z: -0.4,
    state: "encendida",
  },
  {
    id: "vending-machines",
    label: "Máquinas expendedoras",
    type: "leisure",
    zoneId: "ping-pong",
    x: 9.8,
    z: -0.4,
    state: "snacks y bebidas",
  },
  {
    id: "pingpong-board",
    label: "Marcador de torneo",
    type: "leisure",
    zoneId: "ping-pong",
    x: 4.24,
    z: -4.5,
    state: "tablero de puntuación",
  },

  // Lounge Multimedia
  {
    id: "lounge-tv",
    label: "Televisor del lounge",
    type: "leisure",
    zoneId: "lounge-tv",
    x: 8.0,
    z: 0.4,
    state: "pantalla ambiental encendida",
  },
  {
    id: "lounge-sofas",
    label: "Sofás del lounge",
    type: "leisure",
    zoneId: "lounge-tv",
    x: 8.0,
    z: 5.2,
    state: "zona cómoda de descanso",
  },
];

const AGENT_DESK_NAMES = {
  architect: "Escritorio del Tech Lead",
  frontend: "Escritorio de Frontend Dev",
  qa: "Escritorio de DevOps / QA",
  backend: "Escritorio de Backend Dev",
  systems: "Escritorio de Systems Dev",
};

const PEER_REVIEW_CHECKPOINT = {
  architect: "review-architect",
  frontend: "review-frontend",
  qa: "review-qa",
  backend: "review-backend",
  systems: "review-systems",
};

const PEER_ALIASES = {
  architect: ["architect", "tech-lead", "techlead", "lead", "lider", "jefe", "supervisor"],
  frontend: ["frontend", "frontend-dev", "ui", "ux", "webgl"],
  qa: ["qa", "devops", "devops-qa", "reviewer", "test"],
  backend: ["backend", "backend-dev", "api", "servidor", "db"],
  systems: ["systems", "systems-dev", "cli", "sistemas", "infra"],
};

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@+/, "")
    .replace(/[\s_]+/g, "-");
}

function resolveZoneFromCoords(x, z, checkpointId = null, ownerAgentId = null) {
  if (x <= -4.6 && z <= -2.6) {
    if (checkpointId === "supervisor-desk" || ownerAgentId === "architect") {
      return {
        zoneId: "supervisor",
        zoneName: "Oficina del Tech Lead",
        locationLabel:
          checkpointId === "supervisor-desk"
            ? "Escritorio del Tech Lead"
            : "Oficina del Tech Lead",
      };
    }
    return {
      zoneId: "supervisor",
      zoneName: "Oficina del Tech Lead",
      locationLabel: "Oficina del Tech Lead",
    };
  }

  if (x > -4.6 && x <= 4.3 && z <= -2.6) {
    return {
      zoneId: "meeting-room",
      zoneName: "Sala de Reuniones",
      locationLabel:
        checkpointId === "meeting-presenter"
          ? "Pizarra de Arquitectura (Sala de Reuniones)"
          : "Sala de Reuniones",
    };
  }

  if (x > 4.3 && z <= 0.2) {
    return {
      zoneId: "ping-pong",
      zoneName: "Área de Ping-Pong y Arcade",
      locationLabel:
        checkpointId === "arcade-machine"
          ? "Zona Arcade"
          : "Área de Ping-Pong",
    };
  }

  if (x > 4.3 && z > 0.2) {
    return {
      zoneId: "lounge-tv",
      zoneName: "Lounge Multimedia",
      locationLabel: "Lounge Multimedia",
    };
  }

  if (x >= -2.2 && x <= 4.3 && z >= 2.5) {
    return {
      zoneId: "coffee-kitchen",
      zoneName: "Cocina y Barra de Café",
      locationLabel:
        checkpointId?.startsWith("barstool")
          ? "Barra de Café"
          : checkpointId === "kitchen-water-cooler"
            ? "Dispensador de Agua"
            : "Barra de Café y Cocina",
    };
  }

  if (x < -2.2 && z > -2.6) {
    const deskName =
      checkpointId && checkpointId === `dev-pod2-nw`
        ? AGENT_DESK_NAMES.frontend
        : checkpointId === "dev-pod2-ne"
          ? AGENT_DESK_NAMES.qa
          : checkpointId === "dev-pod2-se"
            ? AGENT_DESK_NAMES.backend
            : checkpointId === "dev-pod2-sw"
              ? AGENT_DESK_NAMES.systems
              : null;
    return {
      zoneId: "dev-area",
      zoneName: "Área de Desarrollo",
      locationLabel: deskName || "Área de Desarrollo",
    };
  }

  return {
    zoneId: "corridor",
    zoneName: "Corredor Central",
    locationLabel: "Corredor Central",
  };
}

function describePhysicalPosture(agent) {
  if (!agent) return "disponible";
  if (agent.state === "TRAVELING") return "caminando";
  if (agent.isSeated) return "sentado";
  return "de pie";
}

function describeActivityForPeer(agent) {
  if (!agent) return "disponible";
  if (agent.state === "TRAVELING") return "caminando por la oficina";
  if (agent.taskTitle && !/tecleando código|disponible/i.test(agent.taskTitle)) {
    return agent.taskTitle;
  }
  if (agent.currentActionLabel) {
    return agent.currentActionLabel.toLowerCase();
  }
  return agent.isSeated ? "en su asiento" : "de pie";
}

function pickFirstAvailableCheckpoint(candidates = []) {
  for (const id of candidates) {
    if (checkpointManager.isAvailable(id)) return id;
  }
  return candidates[0] || null;
}

function pickNearestAvailableCheckpoint(targetX, targetZ, excludeIds = new Set()) {
  let bestId = null;
  let bestDist = Infinity;
  for (const cp of Object.values(checkpointManager.checkpoints || {})) {
    if (!cp || excludeIds.has(cp.id)) continue;
    if (!checkpointManager.isAvailable(cp.id)) continue;
    const dx = cp.pos.x - targetX;
    const dz = cp.pos.z - targetZ;
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = cp.id;
    }
  }
  return bestId;
}

export class SpatialAwarenessService {
  constructor({
    characterManager,
    director,
    monitorSystem = null,
    onSync = null,
  } = {}) {
    this.characterManager = characterManager;
    this.director = director;
    this.monitorSystem = monitorSystem;
    this.onSync = onSync;

    this.timerId = null;
    this.lastSignature = "";
    this.lastSyncAt = 0;
    this.processedCommandIds = new Set();
    this.isDestroyed = false;

    this.start();
  }

  start() {
    if (this.timerId || this.isDestroyed) return;
    this.timerId = setInterval(() => {
      if (this.isDestroyed) return;
      if (typeof document !== "undefined" && document.hidden) return;
      this.tickSync();
    }, SPATIAL_SYNC_INTERVAL_MS);
  }

  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  _rememberProcessedCommand(cmdId) {
    const clean = String(cmdId || "").trim();
    if (!clean) return;
    if (this.processedCommandIds.has(clean)) {
      this.processedCommandIds.delete(clean);
    }
    this.processedCommandIds.add(clean);
    while (this.processedCommandIds.size > MAX_PROCESSED_COMMANDS) {
      const oldest = this.processedCommandIds.values().next().value;
      if (!oldest) break;
      this.processedCommandIds.delete(oldest);
    }
  }

  computeSnapshot() {
    const chars = this.characterManager?.characters || [];
    const whiteboardNotes = this.monitorSystem?.getWhiteboardNotes?.() || [];
    const agents = {};
    let sig = `wb:${whiteboardNotes.map((n) => n.id).join(",")}`;

    const positions = chars.map((agent) => {
      const id = agent.config?.id;
      const pos = agent.model?.position || { x: 0, z: 0 };
      const cpId = agent.currentCheckpointId || agent.targetCheckpointId || null;
      const zoneInfo = resolveZoneFromCoords(pos.x, pos.z, cpId, id);
      return {
        agent,
        id,
        name: agent.config?.name || id,
        x: pos.x,
        z: pos.z,
        cpId,
        zoneInfo,
      };
    });

    for (const item of positions) {
      const { agent, id, name, x, z, cpId, zoneInfo } = item;
      const nearbyObjects = [];
      let whiteboardDist = Infinity;

      for (let i = 0; i < OFFICE_PROPS_CATALOG.length; i += 1) {
        const prop = OFFICE_PROPS_CATALOG[i];
        const dist = Math.hypot(prop.x - x, prop.z - z);
        if (prop.id === "meeting-whiteboard") {
          whiteboardDist = dist;
        }
        if (dist <= NEARBY_OBJECT_RADIUS) {
          nearbyObjects.push({
            id: prop.id,
            label: prop.label,
            type: prop.type,
            distanceM: Number(dist.toFixed(1)),
            state: prop.state,
          });
        }
      }
      nearbyObjects.sort((a, b) => a.distanceM - b.distanceM);

      const nearbyPeers = [];
      for (const other of positions) {
        if (other.id === id) continue;
        const dist = Math.hypot(other.x - x, other.z - z);
        const sameZone = other.zoneInfo.zoneId === zoneInfo.zoneId;
        if (sameZone || dist <= NEARBY_PEER_RADIUS) {
          nearbyPeers.push({
            id: other.id,
            name: other.name,
            distanceM: Number(dist.toFixed(1)),
            sameZone,
            zoneName: other.zoneInfo.zoneName,
            activity: describeActivityForPeer(other.agent),
          });
        }
      }
      nearbyPeers.sort((a, b) => a.distanceM - b.distanceM);

      const posture = describePhysicalPosture(agent);
      const whiteboardNear =
        zoneInfo.zoneId === "meeting-room" ||
        whiteboardDist <= WHITEBOARD_VISIBLE_RADIUS;

      const roundedX = Number(x.toFixed(2));
      const roundedZ = Number(z.toFixed(2));
      const targetZone = agent.targetCheckpointId
        ? resolveZoneFromCoords(
            checkpointManager.get(agent.targetCheckpointId)?.pos?.x ?? x,
            checkpointManager.get(agent.targetCheckpointId)?.pos?.z ?? z,
            agent.targetCheckpointId,
            id,
          ).locationLabel
        : null;

      agents[id] = {
        id,
        name,
        color: agent.config?.color || "#E09F5A",
        zoneId: zoneInfo.zoneId,
        zoneName: zoneInfo.zoneName,
        locationLabel: zoneInfo.locationLabel,
        position: { x: roundedX, z: roundedZ },
        posture,
        state: agent.state,
        actionLabel: agent.currentActionLabel || "Disponible",
        taskTitle: agent.taskTitle || null,
        checkpointId: cpId,
        isMoving: agent.state === "TRAVELING",
        targetLocation: targetZone,
        nearbyObjects: nearbyObjects.slice(0, 6),
        nearbyPeers,
        whiteboardNear,
        updatedAt: Date.now(),
      };

      sig += `|${id}:${zoneInfo.zoneId}:${cpId || ""}:${posture}:${agent.state}:${nearbyPeers.map((p) => p.id).join(",")}`;
    }

    return {
      signature: sig,
      snapshot: {
        updatedAt: Date.now(),
        source: "live-3d",
        agents,
        whiteboard: {
          notes: whiteboardNotes,
          updatedAt: whiteboardNotes[0]?.createdAt || null,
        },
      },
    };
  }

  tickSync({ force = false } = {}) {
    if (this.isDestroyed || !this.onSync) return null;
    const now = Date.now();
    if (!force && this.lastSyncAt > 0 && now - this.lastSyncAt < MIN_SYNC_INTERVAL_MS) {
      return null;
    }

    const { signature, snapshot } = this.computeSnapshot();
    const changed = signature !== this.lastSignature;
    const heartbeatDue = now - this.lastSyncAt >= HEARTBEAT_SYNC_MS;

    if (!force && !changed && !heartbeatDue) {
      return null;
    }

    this.lastSignature = signature;
    this.lastSyncAt = now;
    this.onSync(snapshot, { force, changed });
    return snapshot;
  }

  resolveAgentIdentifier(rawAgent) {
    const norm = normalizeKey(rawAgent);
    if (!norm) return null;
    for (const [agentId, aliases] of Object.entries(PEER_ALIASES)) {
      if (agentId === norm || aliases.includes(norm)) {
        return agentId;
      }
    }
    const chars = this.characterManager?.characters || [];
    for (const ch of chars) {
      if (normalizeKey(ch.config?.name) === norm) {
        return ch.config.id;
      }
    }
    return null;
  }

  _resolveDestination(agentId, rawDestination) {
    const norm = normalizeKey(rawDestination);
    const agent = this.characterManager?.getAgent(agentId);
    if (!norm || !agent) return null;

    if (
      norm === "escritorio" ||
      norm === "puesto" ||
      norm === "mi-escritorio" ||
      norm === "desk" ||
      norm === "home"
    ) {
      return {
        checkpointId: agent.homeCheckpointId,
        actionOverride: "typing",
        bubbleText: "Volviendo al escritorio",
        isHome: true,
      };
    }

    if (
      norm === "pizarra" ||
      norm === "whiteboard" ||
      norm === "tablero" ||
      norm === "pizarra-arquitectura"
    ) {
      return {
        checkpointId: "meeting-presenter",
        actionOverride: "presenting",
        bubbleText: "Yendo a la pizarra",
      };
    }

    if (
      norm === "sala-reuniones" ||
      norm === "sala-de-reuniones" ||
      norm === "reuniones" ||
      norm === "meeting"
    ) {
      const cp = pickFirstAvailableCheckpoint([
        "meeting-chair-n1",
        "meeting-chair-s1",
        "meeting-chair-n2",
        "meeting-chair-s2",
        "meeting-chair-n3",
        "meeting-chair-s3",
        "meeting-presenter",
      ]);
      return {
        checkpointId: cp,
        actionOverride: cp === "meeting-presenter" ? "presenting" : "listening",
        bubbleText: "Yendo a sala de reuniones",
      };
    }

    if (
      norm === "cafe" ||
      norm === "cafeteria" ||
      norm === "cocina" ||
      norm === "coffee" ||
      norm === "barra"
    ) {
      const cp = pickFirstAvailableCheckpoint([
        "kitchen-espresso",
        "kitchen-drip-coffee",
        "barstool-1",
        "barstool-2",
        "barstool-3",
        "barstool-4",
      ]);
      return {
        checkpointId: cp,
        actionOverride: cp?.startsWith("barstool") ? "drinkCoffee" : "makeCoffee",
        bubbleText: "Por un café",
      };
    }

    if (norm === "agua" || norm === "water" || norm === "dispensador") {
      return {
        checkpointId: "kitchen-water-cooler",
        actionOverride: "drinkWater",
        bubbleText: "Tomando agua",
      };
    }

    if (norm === "nevera" || norm === "refrigerador" || norm === "fridge") {
      return {
        checkpointId: "kitchen-fridge",
        actionOverride: "openFridge",
        bubbleText: "Yendo a la cocina",
      };
    }

    if (norm === "lounge" || norm === "sofa" || norm === "descanso") {
      const cp = pickFirstAvailableCheckpoint([
        "lounge-sofa-s1",
        "lounge-sofa-s2",
        "lounge-sofa-s3",
        "lounge-armchair-ne",
        "lounge-armchair-se",
        "lounge-puff-orange",
      ]);
      return {
        checkpointId: cp,
        actionOverride: null,
        bubbleText: "Descansando en el lounge",
      };
    }

    if (norm === "ping-pong" || norm === "pingpong" || norm === "mesa-ping-pong") {
      const cp = pickFirstAvailableCheckpoint([
        "pingpong-player-north",
        "pingpong-player-south",
        "pingpong-bench",
        "pingpong-spectator-sofa",
      ]);
      return {
        checkpointId: cp,
        actionOverride: null,
        bubbleText: "Yendo al área de ping-pong",
      };
    }

    if (norm === "arcade" || norm === "recreativa") {
      return {
        checkpointId: "arcade-machine",
        actionOverride: "playArcade",
        bubbleText: "Yendo a la zona arcade",
      };
    }

    if (norm === "librero" || norm === "libros" || norm === "documentacion") {
      return {
        checkpointId: "supervisor-bookcase",
        actionOverride: "browseBooks",
        bubbleText: "Consultando documentación",
      };
    }

    // Destino junto a otro compañero
    const peerId = this.resolveAgentIdentifier(rawDestination);
    if (peerId && peerId !== agentId) {
      const peer = this.characterManager?.getAgent(peerId);
      const peerName = peer?.config?.name || peerId;
      const peerPos = peer?.model?.position;

      const peerNearHome =
        peer &&
        (peer.currentCheckpointId === peer.homeCheckpointId ||
          peer.isPhysicallyAtDesk);

      if (peerNearHome && PEER_REVIEW_CHECKPOINT[peerId]) {
        const reviewCp = PEER_REVIEW_CHECKPOINT[peerId];
        if (checkpointManager.isAvailable(reviewCp)) {
          return {
            checkpointId: reviewCp,
            actionOverride: "talking",
            faceAgentId: peerId,
            bubbleText: `Coordinando con ${peerName}`,
          };
        }
      }

      if (peerPos) {
        const nearbyCp = pickNearestAvailableCheckpoint(
          peerPos.x,
          peerPos.z,
          new Set([peer.currentCheckpointId].filter(Boolean)),
        );
        if (nearbyCp) {
          return {
            checkpointId: nearbyCp,
            actionOverride: "talking",
            faceAgentId: peerId,
            bubbleText: `Acercándose a ${peerName}`,
          };
        }
      }
    }

    // Coincidencia directa con ID de checkpoint
    if (checkpointManager.get(rawDestination)) {
      return {
        checkpointId: rawDestination,
        actionOverride: null,
        bubbleText: "Caminando por la oficina",
      };
    }

    return null;
  }

  executeSpatialCommand(command) {
    if (!command || typeof command !== "object") return false;
    if (command.id && this.processedCommandIds.has(command.id)) {
      return false;
    }
    if (command.id) {
      this._rememberProcessedCommand(command.id);
    }

    const agentId =
      this.resolveAgentIdentifier(command.agentId || command.agente) ||
      command.agentId;
    const agent = this.characterManager?.getAgent(agentId);
    if (!agent || !this.director) return false;

    if (command.type === "write_whiteboard") {
      const noteText = String(command.note || command.nota || command.text || "").trim();
      if (!noteText) return false;

      const notePayload = {
        id: command.noteId || command.id || `wb_${Date.now()}`,
        agentId,
        agentName: agent.config?.name || command.agentName || agentId,
        color: agent.config?.color || command.color || "#8B5CF6",
        text: noteText,
        createdAt: Number(command.createdAt) || Date.now(),
      };

      this.monitorSystem?.addWhiteboardNote(notePayload);
      this.director.holdAgentForSpatialIntent?.(agentId, 20000);
      agent.setContextualBubble("Anotando en la pizarra...", {
        color: "#FCD34D",
        durationMs: 4200,
      });

      this.director.sendAgentTo(agentId, "meeting-presenter", "presenting", {
        onSeated: () => {
          agent.setContextualBubble("Publicó en la pizarra", {
            color: agent.config?.color || "#FCD34D",
            durationMs: 2800,
          });
          this.tickSync({ force: true });
        },
      });
      this.tickSync({ force: true });
      return true;
    }

    if (command.type === "move") {
      const resolved = this._resolveDestination(
        agentId,
        command.destination || command.destino,
      );
      if (!resolved?.checkpointId) return false;

      const cleanReason = String(command.reason || command.motivo || "").trim();
      const bubbleText = cleanReason || resolved.bubbleText;

      if (resolved.isHome) {
        this.director.holdAgentForSpatialIntent?.(agentId, 0);
      } else {
        this.director.holdAgentForSpatialIntent?.(agentId, 20000);
      }

      agent.setContextualBubble(bubbleText, {
        color: agent.config?.color || "#E09F5A",
        durationMs: 3600,
      });

      const faceTarget = resolved.faceAgentId
        ? this.characterManager?.getAgent(resolved.faceAgentId)
        : null;

      this.director.sendAgentTo(
        agentId,
        resolved.checkpointId,
        resolved.actionOverride,
        {
          onSeated: () => {
            if (faceTarget?.model?.position) {
              agent.lookAtWorldPosition(faceTarget.model.position);
            }
            this.tickSync({ force: true });
          },
        },
      );
      this.tickSync({ force: true });
      return true;
    }

    if (command.type === "peer_review") {
      const targetId = this.resolveAgentIdentifier(
        command.targetAgentId || command.destinatario || command.toAgentId,
      );
      const targetAgent = targetId ? this.characterManager?.getAgent(targetId) : null;
      if (!targetAgent || targetId === agentId) return false;

      const targetName = targetAgent.config?.name || targetId;
      const round = Number(command.round || 1);
      const maxRounds = Number(command.maxRounds || 2);

      if (command.escalated || command.limitReached) {
        agent.setContextualBubble(
          `Límite ${round}/${maxRounds} · Requiere tu decisión`,
          {
            color: "#FB7185",
            durationMs: 6500,
          },
        );
        this.tickSync({ force: true });
        return true;
      }

      const reviewCp = PEER_REVIEW_CHECKPOINT[targetId];
      const destCp =
        reviewCp && checkpointManager.isAvailable(reviewCp)
          ? reviewCp
          : this._resolveDestination(agentId, targetId)?.checkpointId;

      this.director.holdAgentForSpatialIntent?.(agentId, 22000);
      agent.setContextualBubble(`Revisión ${round}/${maxRounds} → ${targetName}`, {
        color: agent.config?.color || "#E09F5A",
        durationMs: 4600,
      });
      targetAgent.setContextualBubble(`Revisando (${round}/${maxRounds}) con ${agent.config?.name || agentId}`, {
        color: targetAgent.config?.color || "#8B5CF6",
        durationMs: 4600,
      });

      if (destCp) {
        this.director.sendAgentTo(agentId, destCp, "deskReview", {
          onSeated: () => {
            if (targetAgent.model?.position) {
              agent.lookAtWorldPosition(targetAgent.model.position);
            }
            this.tickSync({ force: true });
          },
        });
      }
      this.tickSync({ force: true });
      return true;
    }

    return false;
  }

  destroy() {
    this.isDestroyed = true;
    this.stop();
  }
}
