import * as THREE from "three";

const DAY_WINDOW_COLOR = new THREE.Color("#FFFFFF");
const NIGHT_WINDOW_COLOR = new THREE.Color("#1E293B");
const DAY_WINDOW_EMISSIVE = new THREE.Color("#FFF5E6");
const NIGHT_WINDOW_EMISSIVE = new THREE.Color("#0F172A");

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
    this.windowGlassMat = null;
    this.lastFactor = -1;

    this.initInteriorLights();
    this.scene.add(this.group);
  }

  initInteriorLights() {
    // Pool de luces puntuales interiores SIN sombras (preserva <= 3 emisores de sombra)
    const fixtures = [
      {
        name: "lounge-table-lamp-light",
        pos: [5.85, 0.95, 5.75],
        color: "#FBBF24",
        maxIntensity: 2.2,
        distance: 6.5,
        decay: 1.6,
      },
      {
        name: "lounge-arc-lamp-light",
        pos: [10.6, 1.95, 5.2],
        color: "#FDE68A",
        maxIntensity: 2.6,
        distance: 7.5,
        decay: 1.5,
      },
      {
        name: "coffee-bar-light",
        pos: [-0.45, 2.35, 5.9],
        color: "#FED7AA",
        maxIntensity: 2.8,
        distance: 7.5,
        decay: 1.5,
      },
      {
        name: "dev-area-light",
        pos: [-7.2, 2.65, 4.4],
        color: "#E0F2FE",
        maxIntensity: 3.1,
        distance: 10.0,
        decay: 1.4,
      },
      {
        name: "supervisor-desk-light",
        pos: [-8.4, 2.55, -5.6],
        color: "#FDE68A",
        maxIntensity: 2.4,
        distance: 7.2,
        decay: 1.5,
      },
      {
        name: "meeting-room-light",
        pos: [0.0, 2.65, -6.0],
        color: "#E2E8F0",
        maxIntensity: 2.5,
        distance: 8.0,
        decay: 1.5,
      },
      {
        name: "pingpong-area-light",
        pos: [7.5, 2.65, -4.5],
        color: "#FEF3C7",
        maxIntensity: 2.4,
        distance: 8.5,
        decay: 1.5,
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

  update(dayNightCycle) {
    if (Math.abs(dayNightCycle - this.lastFactor) < 0.0005) {
      return;
    }
    this.lastFactor = dayNightCycle;

    // Curva suave: las luces interiores empiezan a encenderse a partir de twilight (0.2)
    const nightWeight = THREE.MathUtils.smoothstep(dayNightCycle, 0.15, 0.82);
    const lightsActive = nightWeight > 0.002;

    for (let i = 0; i < this.zoneLights.length; i++) {
      const item = this.zoneLights[i];
      item.light.visible = lightsActive;
      if (lightsActive) {
        item.light.intensity = item.maxIntensity * nightWeight;
      }
    }

    for (let i = 0; i < this.emissiveShades.length; i++) {
      this.emissiveShades[i].emissiveIntensity = 1.25 * nightWeight;
    }

    if (this.windowGlassMat) {
      _winColor.copy(DAY_WINDOW_COLOR).lerp(NIGHT_WINDOW_COLOR, dayNightCycle);
      _winEmissive
        .copy(DAY_WINDOW_EMISSIVE)
        .lerp(NIGHT_WINDOW_EMISSIVE, dayNightCycle);
      this.windowGlassMat.color.copy(_winColor);
      this.windowGlassMat.emissive.copy(_winEmissive);
      this.windowGlassMat.emissiveIntensity = THREE.MathUtils.lerp(
        0.45,
        0.1,
        dayNightCycle,
      );
    }
  }

  dispose() {
    this.zoneLights.forEach((z) => z.light.dispose?.());
    this.zoneLights = [];
    this.emissiveShades = [];
  }
}
