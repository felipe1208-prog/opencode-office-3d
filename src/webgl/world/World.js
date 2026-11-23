import * as THREE from "three";
import { Floor } from "../environment/Floor.js";
import { DioramaShell } from "../environment/DioramaShell.js";
import { CarpetSystem } from "../environment/CarpetSystem.js";
import { GlassPartitions } from "../environment/GlassPartitions.js";
import { InteriorWalls } from "../environment/InteriorWalls.js";
import { SupervisorOffice } from "../zones/SupervisorOffice.js";
import { MeetingRoom } from "../zones/MeetingRoom.js";
import { DevArea } from "../zones/DevArea.js";
import { CoffeeArea } from "../zones/CoffeeArea.js";
import { PingPongArea } from "../zones/PingPongArea.js";
import { LoungeArea } from "../zones/LoungeArea.js";
import { CharacterManager } from "../characters/CharacterManager.js";
import { AGENT_RAYCAST_LAYER } from "../characters/CharacterModel.js";
import { SimulationDirector } from "../characters/SimulationDirector.js";
import { PropPersistenceManager } from "../characters/PropPersistenceManager.js";
import { AmbientAudioSystem } from "../audio/AmbientAudioSystem.js";
import { MonitorScreenSystem } from "./MonitorScreenSystem.js";
import { NightLightingRig } from "./NightLightingRig.js";
import { SpatialAwarenessService } from "./SpatialAwarenessService.js";
import { MaterialPool, batchStaticZones } from "../utils/SceneOptimizer.js";
import { officeEventBus, OFFICE_EVENTS } from "../../events/OfficeEventBus.js";
import { agentProfileManager } from "../../state/officeWorkspace.js";
import { checkpointManager } from "../interaction/CheckpointManager.js";

const INTERACTIVE_PROP_SPECS = [
  {
    id: "prop-whiteboard",
    propKind: "whiteboard",
    agentId: null,
    label: "Pizarra de Arquitectura",
    hint: "Leer y fijar decisiones del equipo",
    position: [1.85, 2.05, -8.92],
    size: [2.28, 1.48, 0.28],
    focusTarget: [1.85, 2.0, -8.9],
    focusCamPos: [1.85, 3.1, -2.5],
  },
  {
    id: "prop-meeting-table",
    propKind: "meeting-table",
    agentId: null,
    label: "Mesa de Reuniones",
    hint: "Convocar Standup rápido con el equipo",
    position: [0.0, 0.72, -6.0],
    size: [4.45, 0.72, 1.88],
    focusTarget: [0.0, 0.9, -6.0],
    focusCamPos: [5.4, 6.4, -0.4],
  },
  {
    id: "prop-monitor-architect",
    propKind: "monitor",
    agentId: "architect",
    hint: "Abrir Inspector Git y actividad técnica",
    position: [-8.4, 0.98, -5.26],
    size: [1.26, 0.62, 0.52],
    focusTarget: [-8.4, 1.0, -5.26],
    focusCamPos: [-4.2, 4.4, -1.2],
  },
  {
    id: "prop-monitor-frontend",
    propKind: "monitor",
    agentId: "frontend",
    hint: "Abrir Inspector Git y actividad técnica",
    position: [-6.7, 0.96, 4.98],
    size: [1.14, 0.56, 0.46],
    focusTarget: [-6.7, 0.98, 4.98],
    focusCamPos: [-3.2, 4.2, 8.8],
  },
  {
    id: "prop-monitor-qa",
    propKind: "monitor",
    agentId: "qa",
    hint: "Abrir Inspector Git y actividad técnica",
    position: [-5.3, 0.96, 4.98],
    size: [1.14, 0.56, 0.46],
    focusTarget: [-5.3, 0.98, 4.98],
    focusCamPos: [-1.8, 4.2, 8.8],
  },
  {
    id: "prop-monitor-backend",
    propKind: "monitor",
    agentId: "backend",
    hint: "Abrir Inspector Git y actividad técnica",
    position: [-5.3, 0.96, 5.42],
    size: [1.14, 0.56, 0.46],
    focusTarget: [-5.3, 0.98, 5.42],
    focusCamPos: [-1.8, 4.2, 9.2],
  },
  {
    id: "prop-monitor-systems",
    propKind: "monitor",
    agentId: "systems",
    hint: "Abrir Inspector Git y actividad técnica",
    position: [-6.7, 0.96, 5.42],
    size: [1.14, 0.56, 0.46],
    focusTarget: [-6.7, 0.98, 5.42],
    focusCamPos: [-3.2, 4.2, 9.2],
  },
];

export class World {
  constructor(experience, { onAgentUpdate = null, onDirectorChange = null } = {}) {
    this.experience = experience;
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.materialPool = new MaterialPool();

    // 0. Sistemas diegéticos y de iluminación nocturna (disponibles antes de construir zonas)
    this.monitorSystem = new MonitorScreenSystem();
    this.nightRig = new NightLightingRig(this.scene);
    this.experience.monitorSystem = this.monitorSystem;
    this.experience.nightRig = this.nightRig;

    // 1. Estructura y cerramientos
    this.floor = new Floor(this.scene);
    this.shell = new DioramaShell(this.scene);
    this.nightRig.registerWindowMaterial(this.shell.windowGlassMat);

    this.carpets = new CarpetSystem(this.scene);
    this.glass = new GlassPartitions(this.scene, this.resources);
    this.interiorWalls = new InteriorWalls(this.scene);

    // 2. Zonas Amuebladas
    this.supervisor = new SupervisorOffice(this.experience);
    this.meeting = new MeetingRoom(this.experience);
    this.devArea = new DevArea(this.experience);
    this.coffeeArea = new CoffeeArea(this.experience);
    this.pingPong = new PingPongArea(this.experience);
    this.lounge = new LoungeArea(this.experience);

    // 2.5 Batching automático (InstancedMesh para repetidos + mergeGeometries por material)
    this.staticBatchResult = batchStaticZones(
      this.scene,
      [
        this.carpets.group,
        this.supervisor.group,
        this.meeting.group,
        this.devArea.group,
        this.coffeeArea.group,
        this.pingPong.group,
        this.lounge.group,
      ],
      { materialPool: this.materialPool },
    );

    // 2.6 Proxies invisibles de raycasting para mobiliario interactivo (sin coste de renderizado)
    this.interactivePropGroup = new THREE.Group();
    this.interactivePropGroup.name = "interactive-prop-proxies";
    this.interactivePropProxies = [];
    this.interactivePropMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this._initInteractivePropProxies();
    this.scene.add(this.interactivePropGroup);

    this.unsubProfileProxySync = officeEventBus.on(
      OFFICE_EVENTS.AGENT_PROFILE_UPDATED,
      ({ agentId, profile } = {}) => {
        if (!agentId || !profile) return;
        for (const proxy of this.interactivePropProxies) {
          if (proxy.userData.propKind === "monitor" && proxy.userData.agentId === agentId) {
            proxy.userData.label = `Monitor · ${profile.name}`;
          }
        }
      },
    );

    // 3. Personajes, Sockets, Persistencia Física de Objetos, Burbujas y Director conectado al Event Bus
    this.characters = new CharacterManager(this.experience, (agentId, snap) => {
      this.monitorSystem.syncFromAgentSnapshots({ [agentId]: snap });
      if (onAgentUpdate) onAgentUpdate(agentId, snap);
    });
    this.propPersistence = new PropPersistenceManager(
      this.scene,
      this.resources,
      this.characters,
    );
    this.director = new SimulationDirector(this.characters, {
      onDirectorChange,
      monitorSystem: this.monitorSystem,
      pingPongArea: this.pingPong,
      coffeeArea: this.coffeeArea,
      propPersistence: this.propPersistence,
    });

    // 3.5 Sistema de Audio Espacial Sutil (Web Audio API posicional)
    this.ambientAudioSystem = new AmbientAudioSystem(this.experience);

    // 4. Servicio ligero de conciencia espacial (<= 2 Hz, fuera del bucle rAF)
    this.spatialService = new SpatialAwarenessService({
      characterManager: this.characters,
      director: this.director,
      monitorSystem: this.monitorSystem,
      onSync: (snapshot) => {
        officeEventBus.emit(
          OFFICE_EVENTS.OFFICE_SPATIAL_STATE,
          snapshot,
          "spatial-3d",
        );
      },
    });
    this.director.setSpatialService(this.spatialService);
  }

  _initInteractivePropProxies() {
    for (const spec of INTERACTIVE_PROP_SPECS) {
      const geo = new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
      const proxy = new THREE.Mesh(geo, this.interactivePropMaterial);
      proxy.name = spec.id;
      proxy.position.set(spec.position[0], spec.position[1], spec.position[2]);
      proxy.layers.set(AGENT_RAYCAST_LAYER);
      proxy.castShadow = false;
      proxy.receiveShadow = false;

      let resolvedLabel = spec.label;
      if (spec.propKind === "monitor" && spec.agentId) {
        const profile = agentProfileManager.getProfile(spec.agentId);
        resolvedLabel = `Monitor · ${profile?.name || spec.agentId}`;
      }

      proxy.userData = {
        targetType: "prop",
        propId: spec.id,
        propKind: spec.propKind,
        agentId: spec.agentId || null,
        label: resolvedLabel,
        hint: spec.hint,
        focusTarget: spec.focusTarget,
        focusCamPos: spec.focusCamPos,
      };
      this.interactivePropGroup.add(proxy);
      this.interactivePropProxies.push(proxy);
    }
  }

  getInteractivePropSpec(propKind, agentId = null) {
    return (
      this.interactivePropProxies.find(
        (p) =>
          p.userData.propKind === propKind &&
          (!agentId || p.userData.agentId === agentId),
      )?.userData || null
    );
  }

  setDayNightFactor(factor) {
    this.nightRig?.update(factor);
    this.monitorSystem?.setDayNightFactor(factor);
  }

  update(delta) {
    if (this.supervisor) this.supervisor.update(delta);
    if (this.pingPong) this.pingPong.update(delta);
    if (this.coffeeArea) this.coffeeArea.update(delta);
    if (this.director) this.director.update(delta);
    if (this.characters) this.characters.update(delta);
    if (this.monitorSystem) this.monitorSystem.update(delta);
    if (this.ambientAudioSystem) this.ambientAudioSystem.update(delta);
  }

  destroy() {
    this.unsubProfileProxySync?.();
    for (const proxy of this.interactivePropProxies) {
      proxy.geometry?.dispose();
    }
    this.interactivePropMaterial?.dispose();
    this.interactivePropProxies = [];
    this.spatialService?.destroy();
    this.director?.destroy();
    this.propPersistence?.dispose?.();
    this.characters?.destroy();
    this.supervisor?.dispose?.();
    this.pingPong?.dispose?.();
    this.coffeeArea?.dispose?.();
    this.monitorSystem?.dispose();
    this.nightRig?.dispose();
    this.materialPool?.dispose();
    checkpointManager.reset();
  }
}
