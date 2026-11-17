import * as THREE from "three";
import { PROP_DEFS } from "./agents.config.js";
import { fitModel } from "../utils/modelUtils.js";
import { DYNAMIC_SHADOW_LAYER } from "../utils/SceneOptimizer.js";

export class PropSocketManager {
  constructor(model, resources) {
    this.model = model;
    this.resources = resources;
    this.sockets = {
      right: null,
      left: null,
    };
    this.props = new Map();
    this.activePropKey = null;

    this.initSockets();
    this.preloadProps();
  }

  findHandBone(side) {
    const targetPattern =
      side === "right"
        ? /^(?:mixamorig[:_]?)?righthand$/i
        : /^(?:mixamorig[:_]?)?lefthand$/i;

    let found = null;
    this.model.traverse((node) => {
      if (found) return;
      if (node.name && targetPattern.test(node.name.trim())) {
        found = node;
      }
    });

    if (!found) {
      this.model.traverse((node) => {
        if (!found && node.isSkinnedMesh && node.skeleton) {
          found = node.skeleton.bones.find((b) =>
            targetPattern.test((b.name || "").trim()),
          );
        }
      });
    }

    return found;
  }

  initSockets() {
    const rightBone = this.findHandBone("right");
    const leftBone = this.findHandBone("left");

    if (rightBone) {
      const rightSocket = new THREE.Group();
      rightSocket.name = "socket-right-hand";
      rightBone.add(rightSocket);
      this.sockets.right = rightSocket;
    }

    if (leftBone) {
      const leftSocket = new THREE.Group();
      leftSocket.name = "socket-left-hand";
      leftBone.add(leftSocket);
      this.sockets.left = leftSocket;
    }
  }

  preloadProps() {
    Object.entries(PROP_DEFS).forEach(([key, def]) => {
      const socket = this.sockets[def.hand || "right"];
      if (!socket) return;

      let propNode = null;
      if (def.assetName && this.resources) {
        const raw = this.resources.get(def.assetName);
        if (raw) {
          const clone = raw.clone(true);
          clone.traverse((c) => {
            if (c.isMesh) {
              c.castShadow = true;
              c.receiveShadow = true;
              c.layers.enable(DYNAMIC_SHADOW_LAYER);
            }
          });
          propNode = fitModel(clone, { maxDim: def.maxDim || 0.1 });
        }
      }

      if (!propNode) {
        propNode = this.createProceduralProp(def.procedural || key);
        if (propNode) {
          propNode.traverse((c) => {
            if (c.isMesh && c.castShadow) {
              c.layers.enable(DYNAMIC_SHADOW_LAYER);
            }
          });
        }
      }

      if (propNode) {
        propNode.name = `prop-${key}`;
        propNode.position.set(...(def.offset || [0, 0.06, 0.03]));
        propNode.rotation.set(...(def.rotation || [0, 0, 0]));
        propNode.visible = false;
        socket.add(propNode);
        this.props.set(key, propNode);
      }
    });
  }

  createProceduralProp(type) {
    const group = new THREE.Group();

    if (type === "pingPongPaddle") {
      const blade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.01, 20),
        new THREE.MeshStandardMaterial({ color: "#DC2626", roughness: 0.48 }),
      );
      blade.position.y = 0.14;
      blade.rotation.x = Math.PI / 2;
      blade.castShadow = true;

      const trim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.074, 0.074, 0.008, 20),
        new THREE.MeshStandardMaterial({ color: "#0F172A", roughness: 0.6 }),
      );
      trim.position.y = 0.14;
      trim.rotation.x = Math.PI / 2;

      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.095, 0.016),
        new THREE.MeshStandardMaterial({ color: "#B45309", roughness: 0.55 }),
      );
      handle.position.y = 0.035;
      handle.castShadow = true;

      group.add(trim, blade, handle);
      return group;
    }

    if (type === "smartphone") {
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.064, 0.125, 0.009),
        new THREE.MeshStandardMaterial({
          color: "#0F172A",
          roughness: 0.28,
          metalness: 0.8,
        }),
      );
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.056, 0.112),
        new THREE.MeshStandardMaterial({
          color: "#0EA5E9",
          emissive: "#0284C7",
          emissiveIntensity: 0.55,
          roughness: 0.15,
        }),
      );
      screen.position.z = 0.005;
      group.add(body, screen);
      return group;
    }

    if (type === "clipboard") {
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.24, 0.008),
        new THREE.MeshStandardMaterial({ color: "#475569", roughness: 0.55 }),
      );
      const paper = new THREE.Mesh(
        new THREE.BoxGeometry(0.155, 0.205, 0.004),
        new THREE.MeshStandardMaterial({ color: "#F8FAFC", roughness: 0.85 }),
      );
      paper.position.z = 0.005;
      const clip = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.022, 0.014),
        new THREE.MeshStandardMaterial({
          color: "#CBD5E1",
          metalness: 0.85,
          roughness: 0.25,
        }),
      );
      clip.position.set(0, 0.11, 0.006);
      group.add(board, paper, clip);
      return group;
    }

    // Fallback taza simple
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.03, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: "#F8FAFC", roughness: 0.3 }),
    );
    mug.position.y = 0.04;
    group.add(mug);
    return group;
  }

  attach(propKey) {
    if (this.activePropKey === propKey) return;
    this.detachAll();
    if (!propKey) return;

    const node = this.props.get(propKey);
    if (node) {
      node.visible = true;
      this.activePropKey = propKey;
    }
  }

  detachAll() {
    for (const node of this.props.values()) {
      node.visible = false;
    }
    this.activePropKey = null;
  }

  getActivePropLabel() {
    if (!this.activePropKey) return "Ninguno";
    return PROP_DEFS[this.activePropKey]?.label || this.activePropKey;
  }

  dispose() {
    this.detachAll();
    this.props.clear();
  }
}
