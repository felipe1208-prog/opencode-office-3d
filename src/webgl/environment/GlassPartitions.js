import * as THREE from "three";
import { DIORAMA_CONFIG } from "../../config/officeLayout.js";
import { mergeStaticGroupByMaterial } from "../utils/SceneOptimizer.js";
import {
  createContactShadowDecal,
  createZoneSignPlaque,
  getProceduralPBRTextures,
} from "../utils/ProceduralTextures.js";

export class GlassPartitions {
  constructor(scene, resources) {
    this.scene = scene;
    this.resources = resources;
    this.group = new THREE.Group();
    this.group.name = "acoustic-glass-system";

    this.initMaterials();
    this.buildSupervisorRoom();
    this.buildMeetingRoom();
    this.buildPlanterBoxes();

    mergeStaticGroupByMaterial(this.group, {
      namePrefix: "glass-partitions",
      staticShadow: true,
    });
    this.scene.add(this.group);
  }

  initMaterials() {
    const pbr = getProceduralPBRTextures();

    // Perfilería metálica cepillada en grafito arquitectónico
    this.frameMat = new THREE.MeshStandardMaterial({
      color: "#1E232B",
      roughnessMap: pbr.brushedMetalRoughnessMap,
      bumpMap: pbr.brushedMetalBumpMap,
      bumpScale: 0.004,
      roughness: 0.42,
      metalness: 0.84,
      envMapIntensity: 1.15,
    });

    // Junquillo interior satinado contrastado para borde biselado visual
    this.trimMat = new THREE.MeshStandardMaterial({
      color: "#525B69",
      roughness: 0.34,
      metalness: 0.88,
      envMapIntensity: 1.25,
    });

    // Vidrio arquitectónico ligero (transmission: 0) con clearcoat nítido y reflejos ambientales
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: "#E4F0F6",
      transparent: true,
      opacity: 0.22,
      transmission: 0,
      roughness: 0.035,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      reflectivity: 0.94,
      envMapIntensity: 1.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Banda arquitectónica esmerilada sutil a media altura
    this.frostedBandMat = new THREE.MeshBasicMaterial({
      map: pbr.frostedBandTexture,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.planterMat = new THREE.MeshStandardMaterial({
      color: "#EAE4DA",
      roughnessMap: pbr.matteMicroRoughnessMap,
      bumpMap: pbr.matteMicroBumpMap,
      bumpScale: 0.006,
      roughness: 0.82,
      metalness: 0.02,
    });

    this.foliageMat = new THREE.MeshStandardMaterial({
      color: "#3F6B46",
      roughness: 0.78,
    });
  }

  createGlassSpan(p1, p2, height = 3.2, cols = 2) {
    const len = p1.distanceTo(p2);
    const center = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    const angle = Math.atan2(p2.z - p1.z, p2.x - p1.x);

    const panel = new THREE.Group();
    panel.position.set(center.x, 0, center.z);
    panel.rotation.y = -angle;

    // Paño de vidrio templado
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(len, height),
      this.glassMat,
    );
    glass.position.y = height / 2;
    panel.add(glass);

    // Banda esmerilada de privacidad acústica
    const frosted = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.2, len - 0.12), 0.34),
      this.frostedBandMat,
    );
    frosted.position.set(0, 1.24, 0.002);
    panel.add(frosted);

    // Perfiles estructurales cepillados + junquillos biselados de contraste
    const frameW = 0.1;
    const bottom = new THREE.Mesh(
      new THREE.BoxGeometry(len, frameW, frameW),
      this.frameMat,
    );
    bottom.position.y = frameW / 2;

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(len, frameW, frameW),
      this.frameMat,
    );
    top.position.y = height - frameW / 2;

    const topTrim = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.018, frameW + 0.016),
      this.trimMat,
    );
    topTrim.position.y = height - frameW - 0.005;

    const bottomTrim = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.018, frameW + 0.016),
      this.trimMat,
    );
    bottomTrim.position.y = frameW + 0.005;

    panel.add(bottom, top, topTrim, bottomTrim);

    // Montantes verticales
    for (let i = 0; i <= cols; i++) {
      const px = -len / 2 + (len / cols) * i;
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(frameW, height, frameW),
        this.frameMat,
      );
      post.position.set(px, height / 2, 0);

      const postTrim = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, height - frameW * 2, frameW + 0.014),
        this.trimMat,
      );
      postTrim.position.set(px, height / 2, 0);

      panel.add(post, postTrim);
    }

    return panel;
  }

  createFramedPortal(doorX, z, doorWidth = 1.45, height = 3.2, label = "") {
    const portalGroup = new THREE.Group();
    const frameW = 0.1;
    const doorHeight = 2.35;

    // Jambas izquierda y derecha
    const jambL = new THREE.Mesh(
      new THREE.BoxGeometry(frameW, height, frameW),
      this.frameMat,
    );
    jambL.position.set(doorX - doorWidth / 2, height / 2, z);

    const jambR = new THREE.Mesh(
      new THREE.BoxGeometry(frameW, height, frameW),
      this.frameMat,
    );
    jambR.position.set(doorX + doorWidth / 2, height / 2, z);

    // Dintel intermedio de la puerta con remate cepillado
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, frameW, frameW),
      this.frameMat,
    );
    lintel.position.set(doorX, doorHeight, z);

    const lintelTrim = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, 0.02, frameW + 0.018),
      this.trimMat,
    );
    lintelTrim.position.set(doorX, doorHeight - frameW / 2, z);

    // Viga superior del techo
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(doorWidth, frameW, frameW),
      this.frameMat,
    );
    header.position.set(doorX, height - frameW / 2, z);

    // Cristal fijo superior sobre la puerta
    const glassTop = new THREE.Mesh(
      new THREE.PlaneGeometry(doorWidth, height - doorHeight - frameW),
      this.glassMat,
    );
    glassTop.position.set(doorX, doorHeight + (height - doorHeight) / 2, z);

    portalGroup.add(jambL, jambR, lintel, lintelTrim, header, glassTop);

    if (label) {
      const sign = createZoneSignPlaque(label, "", 0.84, 0.18);
      sign.position.set(doorX, doorHeight + 0.01, z + 0.06);
      portalGroup.add(sign);
    }

    return portalGroup;
  }

  buildSupervisorRoom() {
    const s = DIORAMA_CONFIG.glassRooms.supervisor;
    const H = 3.2;
    const doorX = (s.doorGap.start + s.doorGap.end) / 2;
    const doorW = s.doorGap.end - s.doorGap.start;

    // Fachada Frontal (Sur) continua
    this.group.add(this.createFramedPortal(doorX, s.maxZ, doorW, H, "DIRECCIÓN"));

    const pLeft1 = new THREE.Vector3(s.minX, 0, s.maxZ);
    const pLeft2 = new THREE.Vector3(s.doorGap.start, 0, s.maxZ);
    this.group.add(this.createGlassSpan(pLeft1, pLeft2, H, 2));

    const pRight1 = new THREE.Vector3(s.doorGap.end, 0, s.maxZ);
    const pRight2 = new THREE.Vector3(s.maxX, 0, s.maxZ);
    this.group.add(this.createGlassSpan(pRight1, pRight2, H, 1));

    // Cerramiento lateral Este
    const pEast1 = new THREE.Vector3(s.maxX, 0, s.minZ);
    const pEast2 = new THREE.Vector3(s.maxX, 0, s.maxZ);
    this.group.add(this.createGlassSpan(pEast1, pEast2, H, 2));
  }

  buildMeetingRoom() {
    const m = DIORAMA_CONFIG.glassRooms.meeting;
    const H = 3.2;
    const doorX = (m.doorGap.start + m.doorGap.end) / 2;
    const doorW = m.doorGap.end - m.doorGap.start;

    // Fachada Frontal (Sur) alineada exactamente a Z = -2.8
    this.group.add(
      this.createFramedPortal(doorX, m.maxZ, doorW, H, "SALA DE REUNIONES"),
    );

    const pLeft1 = new THREE.Vector3(m.minX, 0, m.maxZ);
    const pLeft2 = new THREE.Vector3(m.doorGap.start, 0, m.maxZ);
    this.group.add(this.createGlassSpan(pLeft1, pLeft2, H, 2));

    const pRight1 = new THREE.Vector3(m.doorGap.end, 0, m.maxZ);
    const pRight2 = new THREE.Vector3(m.maxX, 0, m.maxZ);
    this.group.add(this.createGlassSpan(pRight1, pRight2, H, 2));

    // Mamparas laterales Oeste y Este
    const pWest1 = new THREE.Vector3(m.minX, 0, -8.5);
    const pWest2 = new THREE.Vector3(m.minX, 0, m.maxZ);
    this.group.add(this.createGlassSpan(pWest1, pWest2, H, 2));

    const pEast1 = new THREE.Vector3(m.maxX, 0, -8.5);
    const pEast2 = new THREE.Vector3(m.maxX, 0, m.maxZ);
    this.group.add(this.createGlassSpan(pEast1, pEast2, H, 2));
  }

  buildPlanterBoxes() {
    const addPlanter = (x, z, w, d) => {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.32, d),
        this.planterMat,
      );
      box.position.set(x, 0.16, z);
      box.castShadow = true;
      box.receiveShadow = true;

      const leaves = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.1, 0.24, d - 0.1),
        this.foliageMat,
      );
      leaves.position.set(x, 0.34, z);
      leaves.castShadow = true;

      const ao = createContactShadowDecal(x, z, w + 0.34, d + 0.34, 0.008);
      this.group.add(box, leaves, ao);
    };

    // Jardineras decorativas de cerámica mate a los pies de la fachada de reuniones
    addPlanter(4.35, -5.5, 0.45, 2.0);
    addPlanter(4.35, -3.4, 0.45, 1.6);
  }
}
