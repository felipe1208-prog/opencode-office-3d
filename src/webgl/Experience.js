import * as THREE from "three";
import { Sizes } from "./core/Sizes.js";
import { Camera } from "./core/Camera.js";
import { Renderer } from "./core/Renderer.js";
import { World } from "./world/World.js";
import { RaycasterHandler } from "./interaction/Raycaster.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";

let instance = null;

const DAY_BG = new THREE.Color("#F7F5F2");
const NIGHT_BG = new THREE.Color("#0F172A");
const DAY_SUN = new THREE.Color("#FFEED4");
const NIGHT_SUN = new THREE.Color("#93C5FD");
const _bgColor = new THREE.Color();
const _sunColor = new THREE.Color();

export class Experience {
  constructor(canvas = null, resources = null, callbacksOrOnSelect = null, legacyOnStatus = null) {
    if (instance) return instance;
    instance = this;

    this.canvas = canvas;
    this.resources = resources;

    if (typeof callbacksOrOnSelect === "function") {
      this.onSelect = callbacksOrOnSelect;
      this.onAgentUpdate = legacyOnStatus;
      this.onDirectorChange = null;
    } else {
      const opts = callbacksOrOnSelect || {};
      this.onSelect = opts.onSelect || null;
      this.onAgentUpdate = opts.onAgentUpdate || null;
      this.onDirectorChange = opts.onDirectorChange || null;
    }

    this.selectedAgentId = null;

    this.scene = new THREE.Scene();
    this.scene.background = DAY_BG.clone();
    this.scene.fog = new THREE.Fog(DAY_BG.clone(), 34, 82);

    this.sizes = new Sizes(this.canvas.parentElement);
    this.camera = new Camera(this);
    this.renderer = new Renderer(this);

    this.initEnvironmentMap();

    this.dayNightCycle = 0.0;
    this.targetDayNight = 0.0;
    this.isAutoCycle = false;
    this.autoClock = 0;

    this.initLighting();
    this.world = new World(this, {
      onAgentUpdate: (agentId, snapshot) => {
        if (this.onAgentUpdate) this.onAgentUpdate(agentId, snapshot);
      },
      onDirectorChange: (directorState) => {
        if (this.onDirectorChange) this.onDirectorChange(directorState);
      },
    });

    this.raycaster = new RaycasterHandler(this, (agentId) => {
      this.handleStationSelect(agentId, { focusCamera: Boolean(agentId) });
    });

    this.unsubLightingBus = officeEventBus.on(
      OFFICE_EVENTS.OFFICE_LIGHTING,
      ({ mode }) => {
        if (mode === "day") this.setDayNightFactor(0.0, false);
        else if (mode === "night") this.setDayNightFactor(0.82, false);
        else if (mode === "auto") this.setDayNightFactor(0.0, true);
      },
    );

    if (!this.renderer.isSoftwareGl) {
      this.renderer.instance.compile(this.scene, this.camera.instance);
    }

    window.experience = this;

    this.sizes.addEventListener("resize", () => {
      this.camera.resize();
      this.renderer.resize();
    });

    this.clock = new THREE.Clock();
    this.tick = this.tick.bind(this);
    this.animationFrameId = requestAnimationFrame(this.tick);
  }

  handleStationSelect(agentId, { focusCamera = true } = {}) {
    this.selectedAgentId = agentId || null;
    this.world?.characters?.setSelectedAgent(this.selectedAgentId);

    if (focusCamera && this.selectedAgentId) {
      const agent = this.world?.characters?.getAgent(this.selectedAgentId);
      if (agent) {
        this.camera.focusOnAgent(agent);
      }
    }

    if (this.onSelect) {
      this.onSelect(this.selectedAgentId);
    }
  }

  resetCamera() {
    this.camera.resetView();
  }

  focusAgent(agentId) {
    const agent = this.world?.characters?.getAgent(agentId);
    if (agent) {
      this.camera.focusOnAgent(agent);
    }
  }

  getAgentSnapshots() {
    return this.world?.characters?.getAllSnapshots() || {};
  }

  setAgentStatus(agentId, status) {
    const agent = this.world?.characters?.getAgent(agentId);
    if (agent) {
      agent.setDesktopStatus(status);
    }
  }

  sendAgentToCheckpoint(agentId, checkpointId, actionKey = null) {
    return this.world?.director?.sendAgentTo(agentId, checkpointId, actionKey);
  }

  sendAgentToWater(agentId) {
    return this.sendAgentToCheckpoint(agentId, "kitchen-water-cooler", "drinkWater");
  }

  forceAgentAnimation(agentId, actionKey) {
    this.world?.director?.forceAgentAnimation(agentId, actionKey);
  }

  sendAgentHome(agentId) {
    const agent = this.world?.characters?.getAgent(agentId);
    if (agent) agent.returnHome();
  }

  setSimulationPaused(paused) {
    this.world?.director?.setPaused(paused);
  }

  setSimulationSpeed(speed) {
    this.world?.director?.setSpeedMultiplier(speed);
  }

  triggerPingPongMatch() {
    return this.world?.director?.triggerPingPongMatch();
  }

  triggerTeamMeeting(topic = null) {
    return this.world?.director?.triggerTeamMeeting(topic || undefined);
  }

  triggerPairChat(agentAId = null, agentBId = null, venue = null) {
    return this.world?.director?.triggerPairChat(agentAId, agentBId, venue);
  }

  triggerDeskReview(hostAgentId = null, reviewerAgentId = null, topic = null) {
    return this.world?.director?.triggerDeskReview(
      hostAgentId,
      reviewerAgentId,
      topic || "Code Review",
    );
  }

  setBubblesVisible(visible) {
    this.world?.characters?.setBubblesVisible(visible);
  }

  returnAllHome() {
    this.world?.director?.returnAllHome();
  }

  setDayNightFactor(factor, auto = false) {
    this.targetDayNight = THREE.MathUtils.clamp(factor, 0.0, 1.0);
    this.isAutoCycle = auto;
  }

  updateLighting(delta) {
    if (this.isAutoCycle) {
      this.autoClock += delta * 0.08;
      this.targetDayNight = (Math.sin(this.autoClock - Math.PI / 2) + 1) * 0.5 * 0.85;
    }

    this.dayNightCycle = THREE.MathUtils.damp(
      this.dayNightCycle,
      this.targetDayNight,
      4.0,
      delta,
    );

    const t = this.dayNightCycle;
    _bgColor.copy(DAY_BG).lerp(NIGHT_BG, t);
    this.scene.background.copy(_bgColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(_bgColor);
    }
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.62, 0.28, t);
    if (this.renderer?.instance) {
      this.renderer.instance.toneMappingExposure = THREE.MathUtils.lerp(
        1.04,
        0.94,
        t,
      );
    }

    _sunColor.copy(DAY_SUN).lerp(NIGHT_SUN, t);
    this.sunLight.color.copy(_sunColor);
    this.sunLight.intensity = THREE.MathUtils.lerp(1.85, 0.52, t);
    this.ambientLight.intensity = THREE.MathUtils.lerp(0.95, 0.28, t);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.55, 0.2, t);
    this.world?.setDayNightFactor(t);
  }

  initEnvironmentMap() {
    if (!this.renderer?.instance) return;
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer.instance);
    const roomEnv = new RoomEnvironment();
    this.envRenderTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.62;
    roomEnv.dispose();
    pmremGenerator.dispose();
  }

  initLighting() {
    this.ambientLight = new THREE.AmbientLight("#FFF7EB", 0.95);
    this.scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight("#FFFDF9", "#7A4B24", 0.55);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight("#FFEED4", 1.85);
    this.sunLight.position.set(-18, 25, -16);
    this.sunLight.target.position.set(0, 0, 0);
    this.scene.add(this.sunLight.target);
    this.sunLight.castShadow = true;

    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 65;

    const d = 18;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);
  }

  tick() {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.updateLighting(delta);
    if (this.world) this.world.update(delta);
    this.camera.update(delta);
    this.renderer.update();
    this.animationFrameId = requestAnimationFrame(this.tick);
  }

  destroy() {
    cancelAnimationFrame(this.animationFrameId);
    this.unsubLightingBus?.();
    this.raycaster?.destroy();
    this.world?.destroy();
    this.envRenderTarget?.dispose();
    this.sizes.destroy();
    this.camera.destroy();
    this.renderer.destroy();
    instance = null;
  }
}
