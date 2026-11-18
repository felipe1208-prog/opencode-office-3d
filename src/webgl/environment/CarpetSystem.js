import * as THREE from "three";
import { DIORAMA_CONFIG } from "../../config/officeLayout.js";
import { getProceduralPBRTextures } from "../utils/ProceduralTextures.js";

export class CarpetSystem {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "carpet-system";

    this.initTextileCarpets();
    this.scene.add(this.group);
  }

  initTextileCarpets() {
    const pbr = getProceduralPBRTextures();
    const sharedGeo = new THREE.PlaneGeometry(1, 1);

    DIORAMA_CONFIG.carpets.forEach((c) => {
      const mat = new THREE.MeshStandardMaterial({
        color: c.color,
        map: pbr.carpetColorMap,
        roughnessMap: pbr.carpetRoughnessMap,
        bumpMap: pbr.carpetBumpMap,
        bumpScale: 0.014,
        roughness: 0.96,
        metalness: 0.02,
        envMapIntensity: 0.65,
      });

      const mesh = new THREE.Mesh(sharedGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.set(c.width, c.length, 1);
      mesh.position.set(c.x, 0.012, c.z);
      mesh.receiveShadow = true;
      mesh.userData.sharedGeometry = true;
      this.group.add(mesh);
    });
  }
}
