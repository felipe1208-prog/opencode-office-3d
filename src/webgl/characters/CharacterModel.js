import * as THREE from "three";
import { DYNAMIC_SHADOW_LAYER } from "../utils/SceneOptimizer.js";

export const AGENT_RAYCAST_LAYER = 1;

export class CharacterModel {
  static create(resources, config) {
    let model = null;

    if (typeof resources.getSkinned === "function") {
      model = resources.getSkinned("character");
    } else {
      const raw = resources.get("character");
      model = (raw.scene || raw).clone(true);
    }

    if (!model) {
      console.warn(
        `[CharacterModel] No se pudo instanciar el modelo para ${config.id}`,
      );
      return null;
    }

    model.name = `character-${config.id}`;
    model.userData.agentId = config.id;
    // 1.14 alarga torso y brazos para conectar cojín de silla y teclas del escritorio
    model.scale.setScalar(1.14);

    const avatarMeshes = [];
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.layers.enable(DYNAMIC_SHADOW_LAYER);
        child.frustumCulled = false;
        child.userData.agentId = config.id;
        avatarMeshes.push(child);

        if (child.material) {
          child.material = child.material.clone();
          child.material.color.set(config.color);
          child.material.roughness = 0.85;
          child.material.metalness = 0.05;
        }
      }
    });
    model.userData.avatarMeshes = avatarMeshes;

    // Proxy simplificado en capa dedicada para raycasting rápido y exacto
    const hitProxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 1.5, 0.62),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hitProxy.name = `hit-proxy-${config.id}`;
    hitProxy.position.set(0, 0.75, 0);
    hitProxy.layers.set(AGENT_RAYCAST_LAYER);
    hitProxy.userData.agentId = config.id;
    hitProxy.castShadow = false;
    hitProxy.receiveShadow = false;
    model.add(hitProxy);

    // Anillo sutil de selección en el suelo alrededor del personaje
    const ringGeo = new THREE.RingGeometry(0.36, 0.44, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: config.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const selectionRing = new THREE.Mesh(ringGeo, ringMat);
    selectionRing.name = "selection-ring";
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.set(0, 0.025, 0);
    selectionRing.visible = false;
    model.add(selectionRing);
    model.userData.selectionRing = selectionRing;
    model.userData.hitProxy = hitProxy;

    return model;
  }
}
