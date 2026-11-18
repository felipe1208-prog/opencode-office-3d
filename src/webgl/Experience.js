import * as THREE from "three";
import { Sizes } from "./core/Sizes.js";
import { Camera } from "./core/Camera.js";
import { Renderer } from "./core/Renderer.js";
import { World } from "./world/World.js";
import { RaycasterHandler } from "./interaction/Raycaster.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";
import {
  DYNAMIC_SHADOW_LAYER,
  STATIC_SHADOW_LAYER,
} from "./utils/SceneOptimizer.js";
import { disposeProceduralPBRTextures } from "./utils/ProceduralTextures.js";

let instance = null;

const DAY_BG = new THREE.Color("#F3EFE8");
const DUSK_BG = new THREE.Color("#2C2436");
const NIGHT_BG = new THREE.Color("#0D1424");
const DAY_SUN = new THREE.Color("#FFF1D6");
const DUSK_SUN = new THREE.Color("#FDBA74");
const NIGHT_SUN = new THREE.Color("#93C5FD");
const DAY_HEMI_SKY = new THREE.Color("#FFFBF4");
const NIGHT_HEMI_SKY = new THREE.Color("#3D5378");
const DAY_HEMI_GROUND = new THREE.Color("#AC7748");
const NIGHT_HEMI_GROUND = new THREE.Color("#4A3420");
const _bgColor = new THREE.Color();
const _sunColor = new THREE.Color();
const _hemiSky = new THREE.Color();
const _hemiGround = new THREE.Color();
const _corner = new THREE.Vector3();

const OFFICE_SHADOW_MIN = new THREE.Vector3(-12.4, -0.4, -9.6);
const OFFICE_SHADOW_MAX = new THREE.Vector3(12.4, 4.0, 9.4);

function fitDirectionalShadowFrustum(light, boundsMin, boundsMax, padding = 0.6) {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  const shadowCam = light.shadow.camera;
  shadowCam.position.copy(light.position);
  shadowCam.lookAt(light.target.position);
  shadowCam.updateMatrixWorld(true);
  shadowCam.matrixWorldInverse.copy(shadowCam.matrixWorld).invert();

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let ix = 0; ix <= 1; ix++) {
    const x = ix === 0 ? boundsMin.x : boundsMax.x;
    for (let iy = 0; iy <= 1; iy++) {
      const y = iy === 0 ? boundsMin.y : boundsMax.y;
      for (let iz = 0; iz <= 1; iz++) {
        const z = iz === 0 ? boundsMin.z : boundsMax.z;
        _corner.set(x, y, z).applyMatrix4(shadowCam.matrixWorldInverse);
        if (_corner.x < minX) minX = _corner.x;
        if (_corner.x > maxX) maxX = _corner.x;
        if (_corner.y < minY) minY = _corner.y;
        if (_corner.y > maxY) maxY = _corner.y;
        // En espacio cámara Three.js mira hacia -Z
        const depth = -_corner.z;
        if (depth < minZ) minZ = depth;
        if (depth > maxZ) maxZ = depth;
      }
    }
  }

  shadowCam.left = minX - padding;
  shadowCam.right = maxX + padding;
  shadowCam.bottom = minY - padding;
  shadowCam.top = maxY + padding;
  shadowCam.near = Math.max(1.0, minZ - padding * 2);
  shadowCam.far = maxZ + padding * 3;
  shadowCam.updateProjectionMatrix();
}

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
    this.scene.fog = new THREE.FogExp2(DAY_BG.getHex(), 0.0082);

    this.sizes = new Sizes(this.canvas.parentElement);
    this.camera = new Camera(this);
    this.renderer = new Renderer(this);
    if (this.camera?.controls) {
      this.camera.controls.enableDamping = !this.renderer.isSoftwareGl;
    }

    this.initEnvironmentMap();

    this.dayNightCycle = 0.0;
    this.targetDayNight = 0.0;
    this.isAutoCycle = false;
    this.autoClock = 0;
    this.lightingAppliedOnce = false;
    this.isPageHidden = typeof document !== "undefined" ? Boolean(document.hidden) : false;
    this.isDestroyed = false;

    this.initLighting();
    this.world = new World(this, {
      onAgentUpdate: (agentId, snapshot) => {
        if (this.onAgentUpdate) this.onAgentUpdate(agentId, snapshot);
      },
      onDirectorChange: (directorState) => {
        if (this.onDirectorChange) this.onDirectorChange(directorState);
      },
    });

    this.invalidateStaticShadows();
    this.updateLighting(0);

    this.raycaster = new RaycasterHandler(this, (agentId) => {
      this.handleStationSelect(agentId, { focusCamera: Boolean(agentId) });
    });

    this.unsubLightingBus = officeEventBus.on(
      OFFICE_EVENTS.OFFICE_LIGHTING,
      ({ mode }) => {
        if (mode === "day") this.setDayNightFactor(0.0, false);
        else if (mode === "dusk") this.setDayNightFactor(0.44, false);
        else if (mode === "night") this.setDayNightFactor(0.84, false);
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
    this.onVisibilityChange = () => {
      if (this.isDestroyed) return;
      if (document.hidden) {
        this.isPageHidden = true;
        if (this.animationFrameId) {
          cancelAnimationFrame(this.animationFrameId);
          this.animationFrameId = null;
        }
      } else if (this.isPageHidden) {
        this.isPageHidden = false;
        this.clock.getDelta();
        if (!this.animationFrameId) {
          this.animationFrameId = requestAnimationFrame(this.tick);
        }
      }
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    if (!this.isPageHidden) {
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
  }

  invalidateStaticShadows() {
    if (this.staticSunLight?.shadow) {
      this.staticSunLight.shadow.needsUpdate = true;
    }
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
    this.lightingAppliedOnce = false;
  }

  updateLighting(delta) {
    if (this.isAutoCycle) {
      this.autoClock += delta * 0.08;
      this.targetDayNight = (Math.sin(this.autoClock - Math.PI / 2) + 1) * 0.5 * 0.85;
    } else if (
      this.lightingAppliedOnce &&
      Math.abs(this.dayNightCycle - this.targetDayNight) < 0.0005
    ) {
      return;
    }

    if (delta > 0) {
      this.dayNightCycle = THREE.MathUtils.damp(
        this.dayNightCycle,
        this.targetDayNight,
        4.0,
        delta,
      );
    } else {
      this.dayNightCycle = this.targetDayNight;
    }

    if (!this.isAutoCycle && Math.abs(this.dayNightCycle - this.targetDayNight) < 0.0005) {
      this.dayNightCycle = this.targetDayNight;
    }

    const t = this.dayNightCycle;
    if (t <= 0.45) {
      const k = t / 0.45;
      _bgColor.copy(DAY_BG).lerp(DUSK_BG, k);
      _sunColor.copy(DAY_SUN).lerp(DUSK_SUN, k);
    } else {
      const k = (t - 0.45) / 0.55;
      _bgColor.copy(DUSK_BG).lerp(NIGHT_BG, k);
      _sunColor.copy(DUSK_SUN).lerp(NIGHT_SUN, k);
    }

    this.scene.background.copy(_bgColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(_bgColor);
      if (this.scene.fog.isFogExp2) {
        this.scene.fog.density = THREE.MathUtils.lerp(0.0082, 0.0132, t);
      }
    }
    this.scene.environmentIntensity = THREE.MathUtils.lerp(0.58, 0.26, t);
    if (this.renderer?.instance) {
      this.renderer.instance.toneMappingExposure = THREE.MathUtils.lerp(
        1.03,
        0.95,
        t,
      );
    }

    const totalSunIntensity = THREE.MathUtils.lerp(1.75, 0.46, t);
    this.staticSunLight.color.copy(_sunColor);
    this.staticSunLight.intensity = totalSunIntensity * 0.65;
    this.dynamicSunLight.color.copy(_sunColor);
    this.dynamicSunLight.intensity = totalSunIntensity * 0.35;

    _hemiSky.copy(DAY_HEMI_SKY).lerp(NIGHT_HEMI_SKY, t);
    _hemiGround.copy(DAY_HEMI_GROUND).lerp(NIGHT_HEMI_GROUND, t);
    this.hemiLight.color.copy(_hemiSky);
    this.hemiLight.groundColor.copy(_hemiGround);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.64, 0.28, t);

    this.ambientLight.intensity = THREE.MathUtils.lerp(0.68, 0.24, t);
    this.world?.setDayNightFactor(t);
    this.lightingAppliedOnce = true;
  }

  initEnvironmentMap() {
    if (!this.renderer?.instance) return;
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer.instance);
    const roomEnv = new RoomEnvironment();
    this.envRenderTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.58;
    roomEnv.dispose();
    pmremGenerator.dispose();
  }

  initLighting() {
    this.ambientLight = new THREE.AmbientLight("#FFF8EE", 0.68);
    this.scene.add(this.ambientLight);

    // Luz hemisférica cálida/fría: cielo suave arriba + rebote cálido del roble abajo
    this.hemiLight = new THREE.HemisphereLight("#FFFBF4", "#AC7748", 0.64);
    this.scene.add(this.hemiLight);

    const sunTarget = new THREE.Object3D();
    sunTarget.position.set(0, 0, 0);
    this.scene.add(sunTarget);

    // 1. Sol estático cacheado (2048x2048, autoUpdate=false, capa STATIC_SHADOW_LAYER)
    this.staticSunLight = new THREE.DirectionalLight("#FFEED4", 1.85 * 0.65);
    this.staticSunLight.position.set(-18, 25, -16);
    this.staticSunLight.target = sunTarget;
    this.staticSunLight.castShadow = true;
    this.staticSunLight.shadow.mapSize.width = 2048;
    this.staticSunLight.shadow.mapSize.height = 2048;
    this.staticSunLight.shadow.autoUpdate = false;
    this.staticSunLight.shadow.needsUpdate = true;
    this.staticSunLight.shadow.camera.layers.set(STATIC_SHADOW_LAYER);
    this.staticSunLight.shadow.bias = -0.0005;
    this.staticSunLight.shadow.normalBias = 0.025;
    this.scene.add(this.staticSunLight);
    fitDirectionalShadowFrustum(
      this.staticSunLight,
      OFFICE_SHADOW_MIN,
      OFFICE_SHADOW_MAX,
      0.7,
    );

    // 2. Sol dinámico en tiempo real SOLO para avatares y props de mano (1024x1024, DYNAMIC_SHADOW_LAYER)
    this.dynamicSunLight = new THREE.DirectionalLight("#FFEED4", 1.85 * 0.35);
    this.dynamicSunLight.position.set(-18, 25, -16);
    this.dynamicSunLight.target = sunTarget;
    this.dynamicSunLight.castShadow = true;
    this.dynamicSunLight.shadow.mapSize.width = 1024;
    this.dynamicSunLight.shadow.mapSize.height = 1024;
    this.dynamicSunLight.shadow.autoUpdate = true;
    this.dynamicSunLight.shadow.camera.layers.set(DYNAMIC_SHADOW_LAYER);
    this.dynamicSunLight.shadow.bias = -0.0005;
    this.dynamicSunLight.shadow.normalBias = 0.025;
    this.scene.add(this.dynamicSunLight);
    fitDirectionalShadowFrustum(
      this.dynamicSunLight,
      OFFICE_SHADOW_MIN,
      OFFICE_SHADOW_MAX,
      0.7,
    );

    // Alias de compatibilidad para cualquier referencia externa
    this.sunLight = this.staticSunLight;
  }

  tick() {
    if (this.isPageHidden || this.isDestroyed) {
      this.animationFrameId = null;
      return;
    }

    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.updateLighting(delta);
    if (this.world) this.world.update(delta);
    this.camera.update(delta);
    this.renderer.update();

    if (this.renderer.isSoftwareGl) {
      this.renderer.afterDraw(() => {
        if (!this.isPageHidden && !this.isDestroyed) {
          this.animationFrameId = requestAnimationFrame(this.tick);
        }
      });
    } else {
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
  }

  destroy() {
    this.isDestroyed = true;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.unsubLightingBus?.();
    this.raycaster?.destroy();
    this.world?.destroy();
    disposeProceduralPBRTextures();
    this.envRenderTarget?.dispose();
    this.sizes.destroy();
    this.camera.destroy();
    this.renderer.destroy();
    instance = null;
  }
}
