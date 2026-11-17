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
import { SimulationDirector } from "../characters/SimulationDirector.js";
import { MonitorScreenSystem } from "./MonitorScreenSystem.js";
import { NightLightingRig } from "./NightLightingRig.js";
import { MaterialPool, batchStaticZones } from "../utils/SceneOptimizer.js";

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

    // 3. Personajes, Sockets, Burbujas y Mock Director conectado al Event Bus
    this.characters = new CharacterManager(this.experience, (agentId, snap) => {
      this.monitorSystem.syncFromAgentSnapshots({ [agentId]: snap });
      if (onAgentUpdate) onAgentUpdate(agentId, snap);
    });
    this.director = new SimulationDirector(this.characters, {
      onDirectorChange,
      monitorSystem: this.monitorSystem,
    });
  }

  setDayNightFactor(factor) {
    this.nightRig?.update(factor);
    this.monitorSystem?.setDayNightFactor(factor);
  }

  update(delta) {
    if (this.supervisor) this.supervisor.update(delta);
    if (this.director) this.director.update(delta);
    if (this.characters) this.characters.update(delta);
  }

  destroy() {
    this.director?.destroy();
    this.characters?.destroy();
    this.monitorSystem?.dispose();
    this.nightRig?.dispose();
    this.materialPool?.dispose();
  }
}
