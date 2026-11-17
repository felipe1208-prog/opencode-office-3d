import * as THREE from "three";
import { DIORAMA_CONFIG } from "../../config/officeLayout.js";
import { configureTexture } from "../utils/SceneOptimizer.js";

export class CarpetSystem {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "carpet-system";

    this.initTextileCarpets();
    this.scene.add(this.group);
  }

  createSharedWeaveTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    // Base neutra clara para teñido multiplicativo exacto por material.color / instanceColor
    ctx.fillStyle = "#F3F4F6";
    ctx.fillRect(0, 0, 512, 512);

    // Trama continua de hilo y relieve textil
    for (let x = 0; x < 512; x += 4) {
      for (let y = 0; y < 512; y += 4) {
        const noise = (Math.sin(x * 0.37 + y * 0.71) * 0.5) * 44;
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, 0.1 + noise / 350)})`;
        ctx.fillRect(x, y, 2, 4);

        ctx.fillStyle = `rgba(15, 23, 42, ${Math.max(0, 0.14 - noise / 350)})`;
        ctx.fillRect(x + 2, y + 2, 2, 2);
      }
    }

    // Micro-acanalado continuo de telar
    for (let i = 0; i < 512; i += 6) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fillRect(i, 0, 1, 512);
      ctx.fillStyle = "rgba(0, 0, 0, 0.09)";
      ctx.fillRect(0, i, 512, 1);
    }

    const texture = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
    });
    texture.repeat.set(3, 3);
    return texture;
  }

  initTextileCarpets() {
    const sharedTexture = this.createSharedWeaveTexture();
    const sharedGeo = new THREE.PlaneGeometry(1, 1);

    DIORAMA_CONFIG.carpets.forEach((c) => {
      const mat = new THREE.MeshStandardMaterial({
        color: c.color,
        map: sharedTexture,
        roughness: 0.82,
        metalness: 0.04,
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
