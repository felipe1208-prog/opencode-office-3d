import * as THREE from "three";
import { ANIMATION_DEFS } from "./agents.config.js";

export class CharacterAnimator {
  constructor(model, resources) {
    this.model = model;
    this.resources = resources;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    this.currentAction = null;
    this.currentAnimName = null;
    this.onClipChanged = null;
    this.oneShotCallbacks = new Map();

    this.initClips();
  }

  // Normaliza Mixamo: escala centímetros a metros (* 0.01) y neutraliza deriva de cadera
  retargetClip(clip, name) {
    if (!clip) return null;
    const retargeted = clip.clone();
    retargeted.name = name;

    retargeted.tracks.forEach((track) => {
      track.name = track.name
        .replace(/.*mixamorig:?/i, "mixamorig")
        .replace(/^_*/, "");

      if (track.name.endsWith(".position")) {
        let hasLargeValues = false;
        for (let i = 0; i < track.values.length; i++) {
          if (Math.abs(track.values[i]) > 5) {
            hasLargeValues = true;
            break;
          }
        }
        if (hasLargeValues) {
          for (let i = 0; i < track.values.length; i++) {
            track.values[i] *= 0.01;
          }
        }

        // Bloqueo de deriva XZ en la pelvis para no salirse de la silla
        const x0 = track.values[0];
        const z0 = track.values[2];
        for (let i = 0; i < track.values.length; i += 3) {
          track.values[i] = x0;
          track.values[i + 2] = z0;
        }
      }
    });

    retargeted.optimize();
    return retargeted;
  }

  initClips() {
    Object.entries(ANIMATION_DEFS).forEach(([animName, def]) => {
      let rawClip = null;
      if (typeof this.resources.getAnimations === "function") {
        const list = this.resources.getAnimations(def.resource);
        if (list && list[0]) rawClip = list[0];
      }
      if (!rawClip) {
        const raw = this.resources.get(def.resource);
        rawClip = raw?.animations?.[0] || null;
      }

      if (rawClip) {
        const processedClip = this.retargetClip(rawClip, animName);
        const action = this.mixer.clipAction(processedClip);
        action.setLoop(def.loop);
        action.timeScale = def.speed || 1.0;
        if (def.loop === THREE.LoopOnce) {
          action.clampWhenFinished = true;
        }
        this.actions.set(animName, action);
      }
    });

    this.mixer.addEventListener("finished", (e) => {
      for (const [animName, action] of this.actions.entries()) {
        if (e.action === action) {
          const cb = this.oneShotCallbacks.get(animName);
          if (cb) {
            this.oneShotCallbacks.delete(animName);
            cb();
          }
          const def = ANIMATION_DEFS[animName];
          if (def?.next && this.actions.has(def.next)) {
            this.play(def.next, 0.2);
          }
          break;
        }
      }
    });
  }

  play(name, duration = 0.22, onFinished = null) {
    const nextAction = this.actions.get(name);
    if (!nextAction) {
      if (onFinished) onFinished();
      return false;
    }

    if (onFinished) {
      this.oneShotCallbacks.set(name, onFinished);
    }

    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.fadeOut(duration);
    }

    nextAction.reset().fadeIn(duration).play();
    this.currentAction = nextAction;
    this.currentAnimName = name;

    if (this.onClipChanged) {
      this.onClipChanged(name);
    }
    return true;
  }

  clearPendingCallbacks() {
    this.oneShotCallbacks.clear();
  }

  update(delta) {
    this.mixer.update(delta);
  }
}
