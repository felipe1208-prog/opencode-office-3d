import * as THREE from "three";
import { AGENT_RAYCAST_LAYER } from "../characters/CharacterModel.js";

export class RaycasterHandler {
  constructor(experience, onSelect) {
    this.experience = experience;
    this.camera = this.experience.camera.instance;
    this.canvas = this.experience.canvas;
    this.onSelect = onSelect;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(AGENT_RAYCAST_LAYER);
    this.mouse = new THREE.Vector2();

    this.pointerStartPos = { x: 0, y: 0 };
    this.isDragging = false;
    this.lastHoverCheck = 0;

    this.bindEvents();
  }

  getHitTargets() {
    return this.experience.world?.characters?.hitProxies || [];
  }

  updateMouseCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  bindEvents() {
    this.onPointerDown = (e) => {
      this.pointerStartPos = { x: e.clientX, y: e.clientY };
      this.isDragging = false;
    };

    this.onPointerMove = (e) => {
      const dist = Math.hypot(
        e.clientX - this.pointerStartPos.x,
        e.clientY - this.pointerStartPos.y,
      );
      if (e.buttons > 0 && dist > 5) {
        this.isDragging = true;
        this.canvas.style.cursor = "grabbing";
        return;
      }

      const now = performance.now();
      if (now - this.lastHoverCheck < 50) return;
      this.lastHoverCheck = now;

      this.updateMouseCoords(e);
      const hitId = this.findHitAgentId();
      this.canvas.style.cursor = hitId ? "pointer" : "default";
    };

    this.onPointerUp = (e) => {
      if (this.isDragging) {
        this.canvas.style.cursor = "default";
        return;
      }

      this.updateMouseCoords(e);
      const hitId = this.findHitAgentId();
      if (this.onSelect) {
        this.onSelect(hitId);
      }
    };

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
  }

  findHitAgentId() {
    const targets = this.getHitTargets();
    if (targets.length === 0) return null;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(targets, false);

    if (intersects.length > 0) {
      return intersects[0].object?.userData?.agentId || null;
    }
    return null;
  }

  destroy() {
    this.canvas.style.cursor = "default";
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
  }
}
