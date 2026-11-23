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

    if (type === "openNotebook") {
      const coverMat = new THREE.MeshStandardMaterial({
        color: "#1E293B",
        roughness: 0.65,
        metalness: 0.1,
      });
      const pageMat = new THREE.MeshStandardMaterial({
        color: "#FAF8F5",
        roughness: 0.85,
      });
      const inkMat = new THREE.MeshStandardMaterial({
        color: "#6366F1",
        roughness: 0.6,
      });
      const ribbonMat = new THREE.MeshStandardMaterial({
        color: "#E11D48",
        roughness: 0.5,
      });

      // Tapas abiertas en ligero ángulo ergonómico
      const leftCover = new THREE.Mesh(
        new THREE.BoxGeometry(0.115, 0.175, 0.006),
        coverMat,
      );
      leftCover.position.set(-0.056, 0, 0);
      leftCover.rotation.y = 0.14;
      leftCover.castShadow = true;

      const rightCover = new THREE.Mesh(
        new THREE.BoxGeometry(0.115, 0.175, 0.006),
        coverMat,
      );
      rightCover.position.set(0.056, 0, 0);
      rightCover.rotation.y = -0.14;
      rightCover.castShadow = true;

      const leftPage = new THREE.Mesh(
        new THREE.BoxGeometry(0.106, 0.165, 0.005),
        pageMat,
      );
      leftPage.position.set(-0.053, 0, 0.004);
      leftPage.rotation.y = 0.14;

      const rightPage = new THREE.Mesh(
        new THREE.BoxGeometry(0.106, 0.165, 0.005),
        pageMat,
      );
      rightPage.position.set(0.053, 0, 0.004);
      rightPage.rotation.y = -0.14;

      // Líneas de notas simuladas sobre las páginas
      for (let i = 0; i < 4; i++) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(0.075, 0.004, 0.002),
          inkMat,
        );
        line.position.set(0.052, 0.045 - i * 0.024, 0.007);
        line.rotation.y = -0.14;
        group.add(line);
      }

      const ribbon = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.19, 0.003),
        ribbonMat,
      );
      ribbon.position.set(0, -0.01, 0.005);

      group.add(leftCover, rightCover, leftPage, rightPage, ribbon);
      return group;
    }

    if (type === "officePen") {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.005, 0.13, 10),
        new THREE.MeshStandardMaterial({
          color: "#1E1B4B",
          roughness: 0.28,
          metalness: 0.65,
        }),
      );
      barrel.position.y = 0.045;
      barrel.castShadow = true;

      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0054, 0.0052, 0.032, 10),
        new THREE.MeshStandardMaterial({
          color: "#334155",
          roughness: 0.65,
        }),
      );
      grip.position.y = 0.088;

      const tipCone = new THREE.Mesh(
        new THREE.ConeGeometry(0.005, 0.018, 10),
        new THREE.MeshStandardMaterial({
          color: "#E2E8F0",
          metalness: 0.9,
          roughness: 0.2,
        }),
      );
      tipCone.position.y = 0.118;

      const clip = new THREE.Mesh(
        new THREE.BoxGeometry(0.0025, 0.036, 0.004),
        new THREE.MeshStandardMaterial({
          color: "#F8FAFC",
          metalness: 0.9,
          roughness: 0.2,
        }),
      );
      clip.position.set(0, 0.002, 0.006);

      group.add(barrel, grip, tipCone, clip);
      return group;
    }

    if (type === "whiteboardMarker") {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.009, 0.009, 0.12, 12),
        new THREE.MeshStandardMaterial({ color: "#F8FAFC", roughness: 0.35 }),
      );
      barrel.position.y = 0.04;
      barrel.castShadow = true;

      const capEnd = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0095, 0.0095, 0.026, 12),
        new THREE.MeshStandardMaterial({ color: "#4F46E5", roughness: 0.32 }),
      );
      capEnd.position.y = -0.022;

      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.0085, 0.02, 12),
        new THREE.MeshStandardMaterial({ color: "#1E293B", roughness: 0.4 }),
      );
      cone.position.y = 0.11;

      const nib = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0025, 0.003, 0.012, 8),
        new THREE.MeshStandardMaterial({ color: "#312E81", roughness: 0.5 }),
      );
      nib.position.y = 0.122;

      group.add(barrel, capEnd, cone, nib);
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

  _mountPropOnHand(propKey, handOverride = null, carryPose = false) {
    if (!propKey) return false;
    const node = this.props.get(propKey);
    const def = PROP_DEFS[propKey];
    if (!node || !def) return false;

    const targetHand = handOverride || def.hand || "right";
    const targetSocket = this.sockets[targetHand];
    if (targetSocket && node.parent !== targetSocket) {
      targetSocket.add(node);
    }

    if (carryPose && def.carryOffset) {
      node.position.set(...def.carryOffset);
    } else if (targetHand === "left" && def.leftOffset) {
      node.position.set(...def.leftOffset);
    } else if (def.offset) {
      node.position.set(...def.offset);
    }

    if (carryPose && def.carryRotation) {
      node.rotation.set(...def.carryRotation);
    } else if (targetHand === "left" && def.leftRotation) {
      node.rotation.set(...def.leftRotation);
    } else if (def.rotation) {
      node.rotation.set(...def.rotation);
    }

    node.visible = true;
    return true;
  }

  attach(
    propKey,
    { secondaryPropKey = null, handOverride = null, carryPose = false } = {},
  ) {
    const signature = `${propKey || ""}:${handOverride || ""}:${carryPose ? "carry" : "std"}+${secondaryPropKey || ""}`;
    if (this._activeSignature === signature) return;
    this.detachAll();
    if (!propKey && !secondaryPropKey) return;

    if (propKey && this._mountPropOnHand(propKey, handOverride, carryPose)) {
      this.activePropKey = propKey;
    }

    if (secondaryPropKey && secondaryPropKey !== propKey) {
      const primaryDef = PROP_DEFS[propKey];
      const primaryHand = handOverride || primaryDef?.hand || "right";
      const secDef = PROP_DEFS[secondaryPropKey];
      const secHand =
        secDef?.hand && secDef.hand !== primaryHand
          ? secDef.hand
          : primaryHand === "right"
            ? "left"
            : "right";
      this._mountPropOnHand(secondaryPropKey, secHand, false);
      this.secondaryPropKey = secondaryPropKey;
    }

    this._activeSignature = signature;
  }

  detachAll() {
    for (const node of this.props.values()) {
      node.visible = false;
    }
    this.activePropKey = null;
    this.secondaryPropKey = null;
    this._activeSignature = null;
  }

  getActivePropLabel() {
    if (!this.activePropKey) return "Ninguno";
    const primaryLabel =
      PROP_DEFS[this.activePropKey]?.label || this.activePropKey;
    if (this.secondaryPropKey && PROP_DEFS[this.secondaryPropKey]) {
      return `${primaryLabel} + ${PROP_DEFS[this.secondaryPropKey].label}`;
    }
    return primaryLabel;
  }

  dispose() {
    this.detachAll();
    for (const node of this.props.values()) {
      node.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose?.();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m?.dispose?.());
          } else {
            child.material?.dispose?.();
          }
        }
      });
      if (node.parent) node.parent.remove(node);
    }
    this.props.clear();
  }
}
