import * as THREE from "three";
import { fitModel } from "../utils/modelUtils.js";
import {
  createContactShadowDecal,
  createLaptopProp,
  createMinimalWallArt,
  getProceduralPBRTextures,
  NORDIC_PALETTE,
} from "../utils/ProceduralTextures.js";

export class MeetingRoom {
  constructor(experience) {
    if (experience && experience.scene) {
      this.experience = experience;
      this.scene = experience.scene;
      this.resources = experience.resources;
    } else {
      this.scene = arguments[0];
      this.resources = arguments[1];
      this.experience = arguments[2] || null;
    }

    this.group = new THREE.Group();
    this.group.name = "zone-meeting-room";
    this.pbr = getProceduralPBRTextures();

    // 1. Mobiliario e infraestructura existente (100% Intacto en layout)
    this.initConferenceTable();
    this.initChairs();
    this.initTableProps();
    this.initPlantsAndDecor();

    // 2. Muro Norte: Pantalla con halo trasero suave y pizarra Kanban física
    this.initWallTV();
    this.initWhiteboard();

    this.scene.add(this.group);
  }

  place(assetName, pos, fitOpts, rotY = 0) {
    const raw = this.resources.get(assetName);
    if (!raw) return null;

    const model = raw.clone(true);
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const fitted = fitModel(model, fitOpts);
    fitted.position.set(pos.x, pos.y, pos.z);
    fitted.rotation.y = rotY;
    this.group.add(fitted);
    return fitted;
  }

  initConferenceTable() {
    const tableGroup = new THREE.Group();
    const tableY = 0.75;
    const tWidth = 4.4;
    const tDepth = 1.6;
    const tThickness = 0.055;

    const topMat = new THREE.MeshStandardMaterial({
      color: "#9A6C45", // Roble nórdico cálido
      map: this.pbr.deskWoodColorMap,
      roughnessMap: this.pbr.deskWoodRoughnessMap,
      bumpMap: this.pbr.deskWoodBumpMap,
      bumpScale: 0.008,
      roughness: 0.72,
      metalness: 0.03,
    });
    const tableTop = new THREE.Mesh(
      new THREE.BoxGeometry(tWidth, tThickness, tDepth),
      topMat,
    );
    tableTop.position.set(0.0, tableY - tThickness / 2, -6.0);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    tableGroup.add(tableTop);

    const grommetMat = new THREE.MeshStandardMaterial({
      color: "#22262E",
      roughnessMap: this.pbr.brushedMetalRoughnessMap,
      roughness: 0.4,
      metalness: 0.84,
    });
    const grommet = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.005, 0.22),
      grommetMat,
    );
    grommet.position.set(0.0, tableY + 0.001, -6.0);
    tableGroup.add(grommet);

    const legMat = new THREE.MeshStandardMaterial({
      color: "#232830",
      roughnessMap: this.pbr.brushedMetalRoughnessMap,
      roughness: 0.44,
      metalness: 0.82,
    });

    const legGeo = new THREE.CylinderGeometry(
      0.24,
      0.28,
      tableY - tThickness,
      24,
    );
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-1.35, (tableY - tThickness) / 2, -6.0);
    legL.castShadow = true;

    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(1.35, (tableY - tThickness) / 2, -6.0);
    legR.castShadow = true;

    // Sombra de contacto AO bajo la mesa de conferencias
    const tableAO = createContactShadowDecal(0.0, -6.0, 5.0, 2.35, 0.0135);
    tableGroup.add(legL, legR, tableAO);
    this.group.add(tableGroup);
  }

  initChairs() {
    const chairHeight = 1.02;
    const setupChairMat = (chairMesh, idx) => {
      if (!chairMesh) return;
      const tone =
        NORDIC_PALETTE.chairsMeeting[idx % NORDIC_PALETTE.chairsMeeting.length];
      chairMesh.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material = child.material.clone();
          child.material.color.set(tone);
          child.material.roughnessMap = this.pbr.carpetRoughnessMap;
          child.material.roughness = 0.78;
          child.material.metalness = 0.04;
        }
      });
    };

    const northX = [-1.35, 0.0, 1.35];
    northX.forEach((x, i) => {
      const rotJitter = i === 1 ? 0 : i === 0 ? 0.06 : -0.06;
      const c = this.place(
        "chair",
        { x, y: 0, z: -6.95 },
        { height: chairHeight },
        rotJitter,
      );
      setupChairMat(c, i);
    });

    const southX = [-1.35, 0.0, 1.35];
    southX.forEach((x, i) => {
      const rotJitter = i === 1 ? Math.PI : Math.PI + (i === 0 ? -0.06 : 0.06);
      const c = this.place(
        "chair",
        { x, y: 0, z: -5.05 },
        { height: chairHeight },
        rotJitter,
      );
      setupChairMat(c, i + 1);
    });

    const cWest = this.place(
      "chair",
      { x: -2.42, y: 0, z: -6.0 },
      { height: chairHeight },
      Math.PI / 2,
    );
    setupChairMat(cWest, 0);

    const cEast = this.place(
      "chair",
      { x: 2.42, y: 0, z: -6.0 },
      { height: chairHeight },
      -Math.PI / 2,
    );
    setupChairMat(cEast, 2);
  }

  initTableProps() {
    const tableY = 0.752;

    this.place(
      "plantFlowerPot",
      { x: 0.0, y: tableY, z: -6.0 },
      { height: 0.28 },
    );

    // Portátil abierto para presentación en cabecera oeste + portátil cerrado en plaza norte
    this.group.add(createLaptopProp(-1.82, tableY, -6.0, Math.PI / 2, true));
    this.group.add(createLaptopProp(0.0, tableY, -6.48, 0.14, false));

    // Control remoto de TV sobre la mesa junto a la bandeja central
    this.place(
      "tvRemote",
      { x: 0.45, y: tableY, z: -5.85 },
      { maxDim: 0.16 },
      0.25,
    );

    const glassPositions = [
      { x: -1.35, z: -6.55 },
      { x: 1.35, z: -6.55 },
      { x: -1.35, z: -5.45 },
      { x: 1.35, z: -5.45 },
      { x: -2.0, z: -6.28 },
    ];
    const fallbackGlassGeo = new THREE.CylinderGeometry(0.035, 0.03, 0.1, 16);
    const fallbackGlassMat = new THREE.MeshPhysicalMaterial({
      color: "#E4F0F6",
      transmission: 0,
      roughness: 0.04,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    glassPositions.forEach((pos) => {
      const g = this.place(
        "waterGlass",
        { x: pos.x, y: tableY, z: pos.z },
        { maxDim: 0.1 },
      );
      if (!g) {
        const glass = new THREE.Mesh(fallbackGlassGeo, fallbackGlassMat);
        glass.position.set(pos.x, tableY + 0.05, pos.z);
        this.group.add(glass);
      }
    });

    const paperMat = new THREE.MeshStandardMaterial({
      color: "#F6F3EC",
      roughnessMap: this.pbr.matteMicroRoughnessMap,
      roughness: 0.9,
    });
    const folderGeo = new THREE.BoxGeometry(0.24, 0.006, 0.32);
    const paperGeo = new THREE.BoxGeometry(0.2, 0.002, 0.28);

    // Carpetas con variación tonal controlada (setColorAt automático en InstancedMesh)
    const addFolder = (x, z, rot, idx) => {
      const folderMat = new THREE.MeshStandardMaterial({
        color: NORDIC_PALETTE.folders[idx % NORDIC_PALETTE.folders.length],
        roughnessMap: this.pbr.matteMicroRoughnessMap,
        roughness: 0.65,
      });
      const f = new THREE.Mesh(folderGeo, folderMat);
      f.position.set(x, tableY + 0.003, z);
      f.rotation.y = rot;
      f.castShadow = true;
      f.userData.sharedGeometry = true;

      const p = new THREE.Mesh(paperGeo, paperMat);
      p.position.set(x, tableY + 0.007, z);
      p.rotation.y = rot;
      p.userData.sharedGeometry = true;
      this.group.add(f, p);
    };

    addFolder(-1.35, -6.36, 0.04, 0);
    addFolder(1.35, -6.36, -0.05, 1);
    addFolder(0.0, -5.6, Math.PI, 2);
    addFolder(1.35, -5.65, Math.PI - 0.08, 3);
  }

  initPlantsAndDecor() {
    this.place(
      "plantFiddleLeaf",
      { x: -3.55, y: 0, z: -8.45 },
      { height: 1.55 },
    );
    this.group.add(createContactShadowDecal(-3.55, -8.45, 0.95, 0.95, 0.008));

    this.place("plantFlowerPot", { x: 3.55, y: 0, z: -8.45 }, { height: 1.15 });
    this.group.add(createContactShadowDecal(3.55, -8.45, 0.85, 0.85, 0.008));

    this.place("trashcan", { x: 3.55, y: 0, z: -3.45 }, { height: 0.4 });

    // Cuadro nórdico discreto en muro norte oeste
    const art = createMinimalWallArt(1, 0.95, 0.68);
    art.position.set(-3.45, 2.25, -8.98);
    this.group.add(art);
  }

  initWallTV() {
    const tvW = 2.45;
    const tvH = 1.4;
    const tvX = -1.8;
    const tvY = 2.15;
    const wallZ = -8.99;

    // Plano de halo trasero suave (bias lighting) activo solo en Tarde y Noche
    const biasMat = new THREE.MeshBasicMaterial({
      map: this.pbr.tvBiasGlowTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const biasPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(tvW + 0.95, tvH + 0.72),
      biasMat,
    );
    biasPlane.position.set(tvX, tvY, wallZ + 0.006);
    this.group.add(biasPlane);
    this.experience?.nightRig?.registerTVBiasGlow(biasPlane, 0.54);

    const frameGeo = new THREE.BoxGeometry(tvW + 0.04, tvH + 0.04, 0.035);
    const frameMat = new THREE.MeshStandardMaterial({
      color: "#1B2028",
      roughnessMap: this.pbr.brushedMetalRoughnessMap,
      roughness: 0.36,
      metalness: 0.85,
    });
    const tvFrame = new THREE.Mesh(frameGeo, frameMat);
    tvFrame.position.set(tvX, tvY, wallZ);
    tvFrame.castShadow = true;
    this.group.add(tvFrame);

    const screenGeo = new THREE.PlaneGeometry(tvW, tvH);
    const screenMat = new THREE.MeshStandardMaterial({
      color: "#07080B",
      roughness: 0.14,
      metalness: 0.15,
    });
    const screenMesh = new THREE.Mesh(screenGeo, screenMat);
    screenMesh.position.set(tvX, tvY, wallZ + 0.019);
    this.group.add(screenMesh);
    this.experience?.monitorSystem?.registerMeetingTV(screenMesh);
  }

  initWhiteboard() {
    // Pizarra Kanban física a altura ergonómica natural
    const wb = this.place(
      "whiteboard",
      { x: 1.85, y: 1.75, z: -8.99 },
      { height: 1.35 },
      0,
    );
    if (wb) {
      wb.rotation.y = 0;
      this.experience?.monitorSystem?.registerMeetingWhiteboard(wb);
    }
  }
}
