import * as THREE from "three";
import { getProceduralPBRTextures } from "../utils/ProceduralTextures.js";

const DAY_WINDOW_COLOR = new THREE.Color("#FFFFFF");
const DUSK_WINDOW_COLOR = new THREE.Color("#FFE8CC");
const NIGHT_WINDOW_COLOR = new THREE.Color("#FFFFFF").lerp(
  new THREE.Color("#1E293B"),
  0.84,
);
const DEEP_NIGHT_WINDOW_COLOR = new THREE.Color("#1E293B");

const DAY_WINDOW_EMISSIVE = new THREE.Color("#FFF5E6");
const DUSK_WINDOW_EMISSIVE = new THREE.Color("#FDBA74");
const NIGHT_WINDOW_EMISSIVE = new THREE.Color("#FFF5E6").lerp(
  new THREE.Color("#0F172A"),
  0.84,
);
const DEEP_NIGHT_WINDOW_EMISSIVE = new THREE.Color("#0F172A");

const _winColor = new THREE.Color();
const _winEmissive = new THREE.Color();
const _lampEmissive = new THREE.Color("#F59E0B");

export class NightLightingRig {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "night-lighting-rig";

    this.zoneLights = [];
    this.emissiveShades = [];
    this.haloPlanes = [];
    this.tvBiasGlows = [];
    this.windowGlassMat = null;
    this.lastFactor = -1;

    this.initInteriorLights();
    this.initAmbientHalos();
    this.scene.add(this.group);
  }

  initInteriorLights() {
    // Pool de luces puntuales prácticas SIN sombras (castShadow = false), apagadas de día
    const fixtures = [
      {
        name: "lounge-table-lamp-light",
        pos: [5.85, 0.95, 5.75],
        color: "#FBBF24",
        maxIntensity: 2.3,
        distance: 5.8,
        decay: 1.7,
      },
      {
        name: "lounge-arc-lamp-light",
        pos: [10.6, 1.95, 5.2],
        color: "#FCD34D",
        maxIntensity: 2.5,
        distance: 6.8,
        decay: 1.6,
      },
      {
        name: "coffee-bar-light",
        pos: [-0.55, 2.2, 5.9],
        color: "#FBBF24",
        maxIntensity: 2.6,
        distance: 6.8,
        decay: 1.6,
      },
      {
        name: "dev-pod1-lamp-light",
        pos: [-10.6, 1.38, 4.9],
        color: "#FBBF24",
        maxIntensity: 2.1,
        distance: 5.5,
        decay: 1.7,
      },
      {
        name: "dev-pod2-lamp-light",
        pos: [-4.95, 1.38, 4.9],
        color: "#FCD34D",
        maxIntensity: 2.1,
        distance: 5.5,
        decay: 1.7,
      },
      {
        name: "dev-pod3-lamp-light",
        pos: [-8.15, 1.38, 0.72],
        color: "#FBBF24",
        maxIntensity: 1.8,
        distance: 4.8,
        decay: 1.7,
      },
      {
        name: "supervisor-desk-light",
        pos: [-8.9, 1.35, -5.25],
        color: "#FBBF24",
        maxIntensity: 2.3,
        distance: 6.2,
        decay: 1.6,
      },
      {
        name: "meeting-room-light",
        pos: [0.0, 2.6, -6.0],
        color: "#FDE68A",
        maxIntensity: 2.4,
        distance: 7.5,
        decay: 1.6,
      },
      {
        name: "meeting-tv-bias-light",
        pos: [-1.8, 2.15, -8.55],
        color: "#BAE6FD",
        maxIntensity: 1.15,
        distance: 4.5,
        decay: 1.8,
      },
      {
        name: "pingpong-area-light",
        pos: [7.5, 2.65, -4.5],
        color: "#FEF3C7",
        maxIntensity: 2.2,
        distance: 8.0,
        decay: 1.6,
      },
    ];

    for (const cfg of fixtures) {
      const light = new THREE.PointLight(cfg.color, 0, cfg.distance, cfg.decay);
      light.name = cfg.name;
      light.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      light.castShadow = false;
      light.visible = false;
      this.group.add(light);
      this.zoneLights.push({ light, maxIntensity: cfg.maxIntensity });
    }
  }

  initAmbientHalos() {
    const pbr = getProceduralPBRTextures();
    // Halos cálidos localizados en suelo / mesa para lámparas prácticas (cero sombras, invisible de día)
    const haloPlacements = [
      { pos: [5.85, 0.51, 5.75], scale: 1.1, maxOpacity: 0.34 },
      { pos: [11.25, 0.02, 5.8], scale: 1.7, maxOpacity: 0.28 },
      { pos: [11.45, 0.02, -6.4], scale: 1.5, maxOpacity: 0.26 },
      { pos: [-1.35, 0.91, 5.85], scale: 1.4, maxOpacity: 0.28 },
      { pos: [-10.78, 0.758, 4.96], scale: 1.15, maxOpacity: 0.28 },
      { pos: [-4.82, 0.758, 4.96], scale: 1.15, maxOpacity: 0.28 },
      { pos: [-8.28, 0.758, 0.76], scale: 1.05, maxOpacity: 0.26 },
      { pos: [-9.02, 0.758, -5.24], scale: 1.15, maxOpacity: 0.32 },
    ];

    const geo = new THREE.PlaneGeometry(1, 1);
    for (const cfg of haloPlacements) {
      const mat = new THREE.MeshBasicMaterial({
        map: pbr.warmHaloTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      mesh.scale.set(cfg.scale, cfg.scale, 1);
      mesh.visible = false;
      mesh.userData.noBatch = true;
      this.group.add(mesh);
      this.haloPlanes.push({ mesh, mat, maxOpacity: cfg.maxOpacity });
    }
  }

  registerWindowMaterial(mat) {
    this.windowGlassMat = mat || null;
  }

  registerLampShadeMaterial(mat) {
    if (!mat) return;
    mat.emissive = _lampEmissive.clone();
    mat.emissiveIntensity = 0;
    mat.userData = mat.userData || {};
    mat.userData.keepMaterialInstance = true;
    this.emissiveShades.push(mat);
  }

  registerTVBiasGlow(mesh, maxOpacity = 0.52) {
    if (!mesh || !mesh.material) return;
    mesh.visible = false;
    mesh.userData.noBatch = true;
    mesh.userData.keepMaterialInstance = true;
    this.tvBiasGlows.push({ mesh, mat: mesh.material, maxOpacity });
  }

  update(dayNightCycle) {
    if (Math.abs(dayNightCycle - this.lastFactor) < 0.0005) {
      return;
    }
    this.lastFactor = dayNightCycle;

    // Curva suave: las luces prácticas arrancan suavemente hacia Tarde (0.14+) y culminan en Noche
    const nightWeight = THREE.MathUtils.smoothstep(dayNightCycle, 0.14, 0.82);
    const lightsActive = nightWeight > 0.002;

    for (let i = 0; i < this.zoneLights.length; i++) {
      const item = this.zoneLights[i];
      item.light.visible = lightsActive;
      if (lightsActive) {
        item.light.intensity = item.maxIntensity * nightWeight;
      }
    }

    for (let i = 0; i < this.emissiveShades.length; i++) {
      this.emissiveShades[i].emissiveIntensity = 1.15 * nightWeight;
    }

    for (let i = 0; i < this.haloPlanes.length; i++) {
      const h = this.haloPlanes[i];
      h.mesh.visible = lightsActive;
      if (lightsActive) {
        h.mat.opacity = h.maxOpacity * nightWeight;
      }
    }

    for (let i = 0; i < this.tvBiasGlows.length; i++) {
      const g = this.tvBiasGlows[i];
      g.mesh.visible = lightsActive;
      if (lightsActive) {
        g.mat.opacity = g.maxOpacity * nightWeight;
      }
    }

    if (this.windowGlassMat) {
      if (dayNightCycle <= 0.44) {
        const k = dayNightCycle / 0.44;
        _winColor.copy(DAY_WINDOW_COLOR).lerp(DUSK_WINDOW_COLOR, k);
        _winEmissive.copy(DAY_WINDOW_EMISSIVE).lerp(DUSK_WINDOW_EMISSIVE, k);
        this.windowGlassMat.emissiveIntensity = THREE.MathUtils.lerp(0.42, 0.48, k);
      } else if (dayNightCycle <= 0.84) {
        const k = (dayNightCycle - 0.44) / 0.4;
        _winColor.copy(DUSK_WINDOW_COLOR).lerp(NIGHT_WINDOW_COLOR, k);
        _winEmissive.copy(DUSK_WINDOW_EMISSIVE).lerp(NIGHT_WINDOW_EMISSIVE, k);
        this.windowGlassMat.emissiveIntensity = THREE.MathUtils.lerp(
          0.48,
          THREE.MathUtils.lerp(0.42, 0.09, 0.84),
          k,
        );
      } else {
        const k = (dayNightCycle - 0.84) / 0.16;
        _winColor.copy(NIGHT_WINDOW_COLOR).lerp(DEEP_NIGHT_WINDOW_COLOR, k);
        _winEmissive.copy(NIGHT_WINDOW_EMISSIVE).lerp(DEEP_NIGHT_WINDOW_EMISSIVE, k);
        this.windowGlassMat.emissiveIntensity = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(0.42, 0.09, 0.84),
          0.09,
          k,
        );
      }
      this.windowGlassMat.color.copy(_winColor);
      this.windowGlassMat.emissive.copy(_winEmissive);
    }
  }

  dispose() {
    this.zoneLights.forEach((z) => z.light.dispose?.());
    this.zoneLights = [];
    this.emissiveShades = [];
    this.haloPlanes.forEach((h) => {
      h.mesh.geometry?.dispose?.();
      h.mat.dispose?.();
    });
    this.haloPlanes = [];
    this.tvBiasGlows = [];
  }
}
