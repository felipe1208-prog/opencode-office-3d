import * as THREE from "three";
import { AGENT_RAYCAST_LAYER } from "../characters/CharacterModel.js";

export class RaycasterHandler {
  constructor(experience, callbacksOrOnSelect) {
    this.experience = experience;
    this.camera = this.experience.camera.instance;
    this.canvas = this.experience.canvas;

    if (typeof callbacksOrOnSelect === "function") {
      this.onSelect = callbacksOrOnSelect;
      this.onPropSelect = null;
      this.onHover = null;
    } else {
      const opts = callbacksOrOnSelect || {};
      this.onSelect = opts.onSelect || null;
      this.onPropSelect = opts.onPropSelect || null;
      this.onHover = opts.onHover || null;
    }

    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(AGENT_RAYCAST_LAYER);
    this.mouse = new THREE.Vector2();

    this.pointerStartPos = { x: 0, y: 0 };
    this.isDragging = false;
    this.lastHoverCheck = 0;
    this._lastHoverId = null;

    this.bindEvents();
  }

  getHitTargets() {
    const agents = this.experience.world?.characters?.hitProxies || [];
    const props = this.experience.world?.interactivePropProxies || [];
    if (props.length === 0) return agents;
    if (agents.length === 0) return props;
    return [...agents, ...props];
  }

  updateMouseCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _clearHover() {
    if (this._lastHoverId !== null) {
      this._lastHoverId = null;
      this.onHover?.(null);
    }
  }

  bindEvents() {
    this.onPointerDown = (e) => {
      this.pointerStartPos.x = e.clientX;
      this.pointerStartPos.y = e.clientY;
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
        this._clearHover();
        return;
      }

      const now = performance.now();
      if (now - this.lastHoverCheck < 50) return;
      this.lastHoverCheck = now;

      this.updateMouseCoords(e);
      const hit = this.findHitTarget();
      this.canvas.style.cursor = hit ? "pointer" : "default";

      if (hit?.type === "prop") {
        this._lastHoverId = hit.propId;
        this.onHover?.({
          ...hit,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      } else {
        this._clearHover();
      }
    };

    this.onPointerLeave = () => {
      this.canvas.style.cursor = "default";
      this._clearHover();
    };

    this.onPointerUp = (e) => {
      if (this.isDragging) {
        this.canvas.style.cursor = "default";
        return;
      }

      this.updateMouseCoords(e);
      const hit = this.findHitTarget();
      if (hit?.type === "prop") {
        this._clearHover();
        this.onPropSelect?.(hit);
        return;
      }
      if (this.onSelect) {
        this.onSelect(hit?.agentId || null);
      }
    };

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  findHitTarget() {
    const targets = this.getHitTargets();
    if (targets.length === 0) return null;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(targets, false);
    if (intersects.length === 0) return null;

    // Priorizar el objeto más cercano; si un avatar está justo junto a su monitor (<0.35m), priorizar el más cercano exacto
    const first = intersects[0];
    const data = first.object?.userData || {};
    if (data.targetType === "prop") {
      return {
        type: "prop",
        propId: data.propId,
        propKind: data.propKind,
        agentId: data.agentId || null,
        label: data.label || "",
        hint: data.hint || "",
        focusTarget: data.focusTarget || null,
        focusCamPos: data.focusCamPos || null,
      };
    }
    if (data.agentId) {
      return {
        type: "agent",
        agentId: data.agentId,
      };
    }
    return null;
  }

  destroy() {
    this._clearHover();
    this.canvas.style.cursor = "default";
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
  }
}
