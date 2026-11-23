import * as THREE from "three";
import { fitModel } from "../utils/modelUtils.js";
import { DYNAMIC_SHADOW_LAYER } from "../utils/SceneOptimizer.js";

/**
 * Coordenadas calibradas de posavasos personales en cada escritorio (y = 0.752m sobre el tablero)
 * y zona de escurridor junto al fregadero de la cocina (y = 0.902m).
 */
export const DESK_DRINK_SPOTS = {
  architect: { x: -8.68, y: 0.752, z: -5.56, rotY: 0.45 },
  frontend: { x: -6.42, y: 0.752, z: 4.68, rotY: -0.35 },
  qa: { x: -5.02, y: 0.752, z: 4.68, rotY: 0.25 },
  systems: { x: -6.98, y: 0.752, z: 5.72, rotY: 2.6 },
  backend: { x: -5.58, y: 0.752, z: 5.72, rotY: -2.4 },
};

export const KITCHEN_DRAINER_SPOTS = [
  { x: -1.42, y: 0.902, z: 5.18, rotY: 0.3 },
  { x: -1.32, y: 0.902, z: 5.26, rotY: -0.5 },
  { x: -1.44, y: 0.902, z: 4.72, rotY: 1.1 },
];

const DRINK_STATION_PROPS = {
  "kitchen-espresso": "coffeeMug",
  "kitchen-drip-coffee": "coffeeMug",
  "kitchen-water-cooler": "waterGlass",
  "kitchen-fridge": "sodaCan",
  "vending-drinks": "sodaCan",
  "vending-snacks": "sodaCan",
};

export class PropPersistenceManager {
  constructor(scene, resources, characterManager) {
    this.scene = scene;
    this.resources = resources;
    this.characterManager = characterManager;

    this.group = new THREE.Group();
    this.group.name = "persistent-owned-props";
    this.group.userData.noBatch = true;
    this.scene.add(this.group);

    // Estado por agente
    this.agentDrinks = new Map();
    // Meshes en el escurridor de cocina
    this.drainerSlots = [];
    this.drainerIndex = 0;

    this._initDrainerMeshes();
    this._initAgentDeskSlots();
  }

  _buildDrinkMesh(propType) {
    const maxDim =
      propType === "sodaCan" ? 0.09 : propType === "waterGlass" ? 0.085 : 0.088;
    let node = null;

    if (this.resources) {
      const raw = this.resources.get(propType);
      if (raw) {
        const clone = raw.clone(true);
        clone.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            c.layers.enable(DYNAMIC_SHADOW_LAYER);
          }
        });
        node = fitModel(clone, { maxDim });
      }
    }

    if (!node) {
      node = new THREE.Group();
      const color =
        propType === "sodaCan"
          ? "#E11D48"
          : propType === "waterGlass"
            ? "#38BDF8"
            : "#F8FAFC";
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.028, 0.082, 14),
        new THREE.MeshStandardMaterial({
          color,
          roughness: propType === "waterGlass" ? 0.15 : 0.32,
          metalness: propType === "sodaCan" ? 0.75 : 0.05,
        }),
      );
      cyl.position.y = 0.041;
      cyl.castShadow = true;
      cyl.layers.enable(DYNAMIC_SHADOW_LAYER);
      node.add(cyl);
    }

    node.userData.noBatch = true;
    node.visible = false;
    this.group.add(node);
    return node;
  }

  _initDrainerMeshes() {
    for (let i = 0; i < KITCHEN_DRAINER_SPOTS.length; i++) {
      const spot = KITCHEN_DRAINER_SPOTS[i];
      const meshes = {
        coffeeMug: this._buildDrinkMesh("coffeeMug"),
        waterGlass: this._buildDrinkMesh("waterGlass"),
      };
      for (const m of Object.values(meshes)) {
        m.position.set(spot.x, spot.y, spot.z);
        m.rotation.set(0, spot.rotY, 0);
        m.visible = false;
      }
      this.drainerSlots.push({
        spot,
        meshes,
        activeType: null,
        fadeTimer: 0,
      });
    }
  }

  _initAgentDeskSlots() {
    const initialOwners = new Set(["architect", "backend"]);

    for (const [agentId, spot] of Object.entries(DESK_DRINK_SPOTS)) {
      const meshes = {
        coffeeMug: this._buildDrinkMesh("coffeeMug"),
        waterGlass: this._buildDrinkMesh("waterGlass"),
        sodaCan: this._buildDrinkMesh("sodaCan"),
      };

      for (const m of Object.values(meshes)) {
        m.position.set(spot.x, spot.y, spot.z);
        m.rotation.set(0, spot.rotY, 0);
        m.visible = false;
      }

      const startsWithCoffee = initialOwners.has(agentId);
      if (startsWithCoffee) {
        meshes.coffeeMug.visible = true;
      }

      this.agentDrinks.set(agentId, {
        agentId,
        spot,
        meshes,
        hasDrinkOnDesk: startsWithCoffee,
        propType: startsWithCoffee ? "coffeeMug" : "coffeeMug",
        sipsRemaining: startsWithCoffee ? 2 : 0,
        carryingToDesk: false,
        carryingToSink: false,
        isSippingAtDesk: false,
        nextSipTimer: 45 + Math.random() * 42, // 45-87s entre sorbos en escritorio
      });
    }
  }

  getAgentDrinkState(agentId) {
    return this.agentDrinks.get(agentId) || null;
  }

  hasEmptyMugOnDesk(agentId) {
    const st = this.agentDrinks.get(agentId);
    return Boolean(
      st &&
        st.hasDrinkOnDesk &&
        st.sipsRemaining <= 0 &&
        !st.carryingToDesk &&
        !st.carryingToSink &&
        !st.isSippingAtDesk,
    );
  }

  hasDrinkReadyToSip(agentId) {
    const st = this.agentDrinks.get(agentId);
    return Boolean(
      st &&
        st.hasDrinkOnDesk &&
        st.sipsRemaining > 0 &&
        !st.carryingToDesk &&
        !st.carryingToSink &&
        !st.isSippingAtDesk,
    );
  }

  _setDeskMeshVisible(st, visible) {
    if (!st) return;
    for (const [type, mesh] of Object.entries(st.meshes)) {
      mesh.visible = Boolean(visible && type === st.propType);
    }
  }

  _placeOnDrainer(propType = "coffeeMug") {
    const slot = this.drainerSlots[this.drainerIndex % this.drainerSlots.length];
    this.drainerIndex += 1;
    if (!slot) return;
    const resolvedType = propType === "waterGlass" ? "waterGlass" : "coffeeMug";
    for (const [type, mesh] of Object.entries(slot.meshes)) {
      mesh.visible = type === resolvedType;
    }
    slot.activeType = resolvedType;
    slot.fadeTimer = 75; // Permanece secándose en el escurridor 75s
  }

  /**
   * Notifica cuando un agente termina de preparar una bebida en cocina/expendedora
   * y comienza a caminar de regreso a su escritorio llevándola en la mano izquierda.
   */
  onAgentAcquiredDrinkFromStation(agentId, checkpointId) {
    const st = this.agentDrinks.get(agentId);
    const agent = this.characterManager?.getAgent(agentId);
    const propType = DRINK_STATION_PROPS[checkpointId];
    if (!st || !agent || !propType) return false;

    this._setDeskMeshVisible(st, false);
    st.propType = propType;
    st.hasDrinkOnDesk = false;
    st.sipsRemaining = 3;
    st.carryingToDesk = true;
    st.carryingToSink = false;
    st.isSippingAtDesk = false;
    st.nextSipTimer = 48 + Math.random() * 38;

    agent.setCarryingDrinkProp?.(propType);
    return true;
  }

  /**
   * Inicia la rutina en la que el agente recoge su taza vacía del escritorio
   * y la lleva caminando hasta el fregadero para enjuagarla.
   */
  beginCarryEmptyMugToSink(agentId, director) {
    const st = this.agentDrinks.get(agentId);
    const agent = this.characterManager?.getAgent(agentId);
    if (!st || !agent || !director) return false;
    if (!st.hasDrinkOnDesk || st.sipsRemaining > 0) return false;

    this._setDeskMeshVisible(st, false);
    st.hasDrinkOnDesk = false;
    st.carryingToSink = true;
    st.carryingToDesk = false;
    st.isSippingAtDesk = false;

    const sent = director.sendAgentTo(agentId, "kitchen-sink", "rinseMug", {
      onSeated: () => {
        // Cuando llega al fregadero, enjuaga la taza bajo el chorro de agua
        agent.setCarryingDrinkProp?.(null);
      },
    });

    if (sent) {
      agent.setCarryingDrinkProp?.(st.propType || "coffeeMug");
      return true;
    }

    // Si el fregadero estaba ocupado, devolver la taza a la mesa
    st.carryingToSink = false;
    st.hasDrinkOnDesk = true;
    this._setDeskMeshVisible(st, true);
    return false;
  }

  /**
   * Ejecuta un sorbo físico de la taza depositada en el escritorio:
   * oculta el mesh de la mesa, lo monta en la mano del avatar durante el sorbo
   * y lo vuelve a depositar sobre el escritorio al terminar.
   */
  triggerDeskSip(agentId, { durationMs = 4600, onComplete = null } = {}) {
    const st = this.agentDrinks.get(agentId);
    const agent = this.characterManager?.getAgent(agentId);
    if (!st || !agent || !agent.isPhysicallyAtDesk()) return false;
    if (!st.hasDrinkOnDesk || st.sipsRemaining <= 0 || st.isSippingAtDesk) {
      return false;
    }

    st.isSippingAtDesk = true;
    this._setDeskMeshVisible(st, false);

    const label =
      st.propType === "waterGlass"
        ? "Bebiendo agua"
        : st.propType === "sodaCan"
          ? "Tomando refresco"
          : "Sorbo de café";

    agent.applyActionProfile("coffeeSipDesk", {
      customLabel: label,
      overrideProp: st.propType,
    });

    agent.scheduleTimer(() => {
      if (!st.isSippingAtDesk) return;
      st.isSippingAtDesk = false;
      st.sipsRemaining = Math.max(0, st.sipsRemaining - 1);
      st.hasDrinkOnDesk = true;
      st.nextSipTimer = 48 + Math.random() * 42;
      this._setDeskMeshVisible(st, true);

      if (agent.isPhysicallyAtDesk() && agent.currentActionKey === "coffeeSipDesk") {
        agent.applyActionProfile("typing");
      }
      onComplete?.(st);
    }, durationMs);

    return true;
  }

  /**
   * Interrupción limpia e inmediata cuando llega una tarea real de OpenCode:
   * deposita cualquier objeto en transporte o uso en su ubicación física válida.
   */
  interruptForLiveTask(agentId) {
    const st = this.agentDrinks.get(agentId);
    const agent = this.characterManager?.getAgent(agentId);
    if (!st) return;

    agent?.setCarryingDrinkProp?.(null);

    if (st.isSippingAtDesk || st.carryingToDesk) {
      st.isSippingAtDesk = false;
      st.carryingToDesk = false;
      st.hasDrinkOnDesk = true;
      if (st.sipsRemaining <= 0) st.sipsRemaining = 2;
      this._setDeskMeshVisible(st, true);
    } else if (st.carryingToSink) {
      st.carryingToSink = false;
      st.hasDrinkOnDesk = false;
      this._setDeskMeshVisible(st, false);
      this._placeOnDrainer(st.propType);
    }
  }

  update(delta, director = null) {
    // 1. Actualizar temporizador de tazas secándose en el escurridor
    for (const slot of this.drainerSlots) {
      if (slot.activeType && slot.fadeTimer > 0) {
        slot.fadeTimer -= delta;
        if (slot.fadeTimer <= 0) {
          slot.activeType = null;
          for (const m of Object.values(slot.meshes)) {
            m.visible = false;
          }
        }
      }
    }

    if (!this.characterManager) return;

    // 2. Supervisar ciclo de vida de bebida por cada agente
    for (const agent of this.characterManager.characters) {
      const agentId = agent.config.id;
      const st = this.agentDrinks.get(agentId);
      if (!st) continue;

      // A) Si está en una estación de bebida preparando café/agua/refresco, marcar adquisición al terminar
      if (
        agent.state === "INTERACTING" &&
        !agent.isTransitioningSeat &&
        DRINK_STATION_PROPS[agent.currentCheckpointId]
      ) {
        st._atDrinkStation = agent.currentCheckpointId;
      } else if (st._atDrinkStation && agent.state === "TRAVELING") {
        const fromStation = st._atDrinkStation;
        st._atDrinkStation = null;
        if (agent.targetCheckpointId === agent.homeCheckpointId) {
          this.onAgentAcquiredDrinkFromStation(agentId, fromStation);
        }
      } else if (agent.state !== "INTERACTING") {
        st._atDrinkStation = null;
      }

      // B) Si estaba enjuagando la taza en el fregadero y termina, dejarla en el escurridor
      if (
        st.carryingToSink &&
        agent.currentCheckpointId === "kitchen-sink" &&
        agent.state === "INTERACTING"
      ) {
        st._rinsingAtSink = true;
        agent.setCarryingDrinkProp?.(null);
      } else if (st._rinsingAtSink && agent.currentCheckpointId !== "kitchen-sink") {
        st._rinsingAtSink = false;
        st.carryingToSink = false;
        this._placeOnDrainer(st.propType);
      }

      // C) Si lleva bebida hacia su escritorio y ya se sentó en su silla, depositarla en la mesa
      if (st.carryingToDesk && agent.isPhysicallyAtDesk()) {
        st.carryingToDesk = false;
        st.hasDrinkOnDesk = true;
        agent.setCarryingDrinkProp?.(null);
        this._setDeskMeshVisible(st, true);
      }

      // D) Micro-pausas orgánicas de sorbo en escritorio cada 45–90s mientras trabaja
      if (
        st.hasDrinkOnDesk &&
        st.sipsRemaining > 0 &&
        !st.isSippingAtDesk &&
        agent.isPhysicallyAtDesk() &&
        agent.state === "WORKING" &&
        agent.currentActionKey === "typing" &&
        !agent.socialMode &&
        (!director || !director.isAgentBusyForAmbient(agentId))
      ) {
        st.nextSipTimer -= delta;
        if (st.nextSipTimer <= 0) {
          this.triggerDeskSip(agentId);
        }
      }
    }
  }

  dispose() {
    this.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m?.dispose?.());
        } else {
          child.material?.dispose?.();
        }
      }
    });
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.agentDrinks.clear();
  }
}
