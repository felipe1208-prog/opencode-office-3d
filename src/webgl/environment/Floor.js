import * as THREE from "three";
import { DIORAMA_CONFIG } from "../../config/officeLayout.js";
import { getProceduralPBRTextures } from "../utils/ProceduralTextures.js";

export class Floor {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "diorama-floor-system";
    this.init();
  }

  init() {
    const pts = DIORAMA_CONFIG.floorPolygon;
    const shape = new THREE.Shape();

    shape.moveTo(pts[0].x, -pts[0].z);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i].x, -pts[i].z);
    }
    shape.closePath();

    const pbr = getProceduralPBRTextures();

    // Material 0: Parquet de roble nórdico cálido con mapas PBR cacheados (roughness + bump)
    const parquetMat = new THREE.MeshStandardMaterial({
      map: pbr.oakColorMap,
      roughnessMap: pbr.oakRoughnessMap,
      bumpMap: pbr.oakBumpMap,
      bumpScale: 0.012,
      roughness: 1.0,
      metalness: 0.02,
      envMapIntensity: 0.85,
    });

    // Material 1: Canto perimetral de la losa en roble oscuro cepillado
    const slabSidesMat = new THREE.MeshStandardMaterial({
      color: "#4F321E",
      roughnessMap: pbr.deskWoodRoughnessMap,
      roughness: 0.78,
      metalness: 0.03,
    });

    // Una sola geometría extruida con multi-material (cero Z-fighting)
    const slabGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.25,
      bevelEnabled: false,
    });

    const floorMesh = new THREE.Mesh(slabGeo, [parquetMat, slabSidesMat]);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.25;
    floorMesh.receiveShadow = true;

    this.group.add(floorMesh);
    this.scene.add(this.group);
  }
}
