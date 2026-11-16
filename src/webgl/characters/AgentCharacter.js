import * as THREE from "three";
import { CharacterModel } from "./CharacterModel.js";
import { CharacterAnimator } from "./CharacterAnimator.js";
import { CharacterLocomotion } from "./CharacterLocomotion.js";
import { PropSocketManager } from "./PropSocketManager.js";
import { AgentStatusBubble } from "./AgentStatusBubble.js";
import { ACTION_PROFILES } from "./agents.config.js";
import { checkpointManager } from "../interaction/CheckpointManager.js";
import { CHECKPOINT_TYPES } from "../interaction/checkpoints.config.js";
import { Pathfinding } from "../navigation/Pathfinding.js";

const FLOOR_Y = -0.34;

export class AgentCharacter {
  constructor(config, resources, onUpdate = null) {
    this.config = config;
    this.resources = resources;
    this.onUpdate = onUpdate;

    this.model = CharacterModel.create(resources, config);
    this.animator = new CharacterAnimator(this.model, resources);
    this.locomotion = new CharacterLocomotion(this.model);
    this.propSockets = new PropSocketManager(this.model, resources);
    this.bubble = new AgentStatusBubble(this.model, config);

    this.homeCheckpointId = config.homeCheckpointId || null;
    this.currentCheckpointId = null;
    this.targetCheckpointId = null;
    this.waitingSeatId = null;

    this.state = "WORKING"; // WORKING | TRAVELING | WAITING | INTERACTING | THINKING | IDLE
    this.isSeated = true;
    this.targetY = FLOOR_Y;
    this.currentActionKey = config.initialAnimation || "typing";
    this.currentActionLabel = "Tecleando código";
    this.taskTitle = null;
    this.taskAccentColor = null;
    this.socialMode = null; // null | "PAIR_CHAT" | "DESK_REVIEW"
    this.socialPartnerName = null;
    this.overrideRotY = null;

    this.pendingTimers = new Set();

    this.animator.onClipChanged = (clipName) => {
      if (clipName === "typing" || clipName === "sittingIdle") {
        // Al regresar a estado base sentado, limpiar props y acentos de reacciones temporales
        if (this.state === "WORKING" || this.state === "IDLE") {
          this.propSockets.detachAll();
          if (this.socialMode !== "DESK_REVIEW") {
            this.taskAccentColor = null;
            this.currentActionLabel = "Tecleando código";
          }
        }
      }
      this.syncBubble();
      this.notifyStateChange();
    };

    this.initHome();
    this.bindEvents();
  }

  scheduleTimer(fn, ms) {
    const id = setTimeout(() => {
      this.pendingTimers.delete(id);
      fn();
    }, ms);
    this.pendingTimers.add(id);
    return id;
  }

  clearTimers() {
    for (const id of this.pendingTimers) {
      clearTimeout(id);
    }
    this.pendingTimers.clear();
    this.animator.clearPendingCallbacks();
  }

  initHome() {
    if (this.homeCheckpointId) {
      const home = checkpointManager.get(this.homeCheckpointId);
      if (home) {
        checkpointManager.reserve(this.homeCheckpointId, this.config.id);
        this.currentCheckpointId = this.homeCheckpointId;
        this.isSeated = true;
        this.targetY = home.pos.y;
        this.model.position.set(home.pos.x, home.pos.y, home.pos.z);
        this.model.rotation.y = home.rotY;
        this.applyActionProfile(this.config.initialAnimation || "typing");
        this.notifyStateChange();
      }
    }
  }

  bindEvents() {
    checkpointManager.on("turn:granted", (data) => {
      if (data.agentId === this.config.id && this.state === "WAITING") {
        this.targetCheckpointId = data.checkpointId;
        this.leaveWaitingSeatAndProceedToTarget();
      }
    });
  }

  setSelected(isSelected) {
    if (this.model?.userData?.selectionRing) {
      this.model.userData.selectionRing.visible = Boolean(isSelected);
    }
  }

  setBubbleVisible(visible) {
    this.bubble?.setVisible(visible);
  }

  updateProfile(profile) {
    if (!profile) return;
    if (profile.name) this.config.name = profile.name;
    if (profile.role) this.config.role = profile.role;
    if (profile.color) {
      this.config.color = profile.color;
      const meshes = this.model?.userData?.avatarMeshes || [];
      for (const child of meshes) {
        if (child.material?.color) {
          child.material.color.set(profile.color);
        }
      }
      if (this.model?.userData?.selectionRing?.material?.color) {
        this.model.userData.selectionRing.material.color.set(profile.color);
      }
    }
    this.bubble?.updateProfile(this.config);
    this.syncBubble();
    this.notifyStateChange();
  }

  syncBubble() {
    if (!this.bubble) return;
    this.bubble.setSeated(this.isSeated);

    let text = this.currentActionLabel;
    let color = this.taskAccentColor || this.config.color;

    if (this.socialMode === "PAIR_CHAT" && this.socialPartnerName) {
      text =
        this.state === "TRAVELING"
          ? `Yendo con ${this.socialPartnerName}`
          : `Charla · ${this.socialPartnerName}`;
    } else if (this.socialMode === "DESK_REVIEW" && this.socialPartnerName) {
      text =
        this.state === "TRAVELING"
          ? `Revisión · ${this.socialPartnerName}`
          : `Revisando · ${this.socialPartnerName}`;
      color = "#38BDF8";
    } else if (this.taskTitle && this.state === "WORKING") {
      text = this.taskTitle;
    }

    this.bubble.setStatus(text, color);
  }

  setSocialContext({ mode = null, partnerName = null, rotY = null } = {}) {
    this.socialMode = mode;
    this.socialPartnerName = partnerName;
    this.overrideRotY = rotY;
    this.syncBubble();
    this.notifyStateChange();
  }

  clearSocialContext() {
    this.socialMode = null;
    this.socialPartnerName = null;
    this.overrideRotY = null;
  }

  applyTaskFeedback({ status = "started", label = null } = {}) {
    if (label) this.taskTitle = label;

    if (status === "passed") {
      this.taskAccentColor = "#10B981";
      this.currentActionLabel = label || "Pruebas en verde";
      if (this.currentCheckpointId === this.homeCheckpointId && this.isSeated) {
        this.applyActionProfile("sittingCheer");
      } else {
        this.syncBubble();
        this.notifyStateChange();
      }
    } else if (status === "failed") {
      this.taskAccentColor = "#EF4444";
      this.currentActionLabel = label || "Fallo detectado";
      if (this.currentCheckpointId === this.homeCheckpointId && this.isSeated) {
        this.applyActionProfile("sittingDisbelief");
      } else {
        this.syncBubble();
        this.notifyStateChange();
      }
    } else {
      this.taskAccentColor = null;
      this.currentActionLabel = label || "Tecleando código";
      if (this.currentCheckpointId !== this.homeCheckpointId) {
        this.returnHome();
      } else {
        this.applyActionProfile("typing");
      }
    }
  }

  applyActionProfile(actionKey, { customLabel = null } = {}) {
    const profile = ACTION_PROFILES[actionKey] || {
      anim: actionKey,
      prop: null,
      label: actionKey,
    };

    const animToPlay = this.animator.actions.has(profile.anim)
      ? profile.anim
      : "standingIdle";

    this.currentActionKey = actionKey;
    this.currentActionLabel = customLabel || profile.label;
    this.propSockets.attach(profile.prop || null);
    this.animator.play(animToPlay, 0.22);
    this.syncBubble();
    this.notifyStateChange();
  }

  requestAction(
    checkpointId,
    {
      overrideAction = null,
      socialMode = null,
      socialPartnerName = null,
      overrideRotY = null,
    } = {},
  ) {
    const targetCP = checkpointManager.get(checkpointId);
    if (!targetCP) return false;

    this.clearTimers();
    this.clearSocialContext();
    this.taskAccentColor = null;
    if (socialMode) {
      this.socialMode = socialMode;
      this.socialPartnerName = socialPartnerName;
    }
    this.overrideRotY = overrideRotY;

    checkpointManager.removeAgentFromAllQueues(this.config.id);
    this.targetCheckpointId = checkpointId;

    const reserved = checkpointManager.reserve(checkpointId, this.config.id);

    if (reserved) {
      this.beginTravel(() => {
        this.navigateTo(targetCP.pos, () => {
          this.arriveAtStation(targetCP, overrideAction);
        });
      });
      return true;
    }

    const waitSeat = checkpointManager.getNearestAvailableWaitingSeat(
      this.model.position,
    );
    if (waitSeat) {
      checkpointManager.reserve(waitSeat.id, this.config.id);
      this.waitingSeatId = waitSeat.id;

      this.beginTravel(() => {
        this.navigateTo(waitSeat.pos, () => {
          this.arriveAtWaitingSeat(waitSeat);
        });
      });
      return true;
    }

    return false;
  }

  beginTravel(onReadyToWalk) {
    this.state = "TRAVELING";
    this.currentActionLabel = "Desplazándose por oficina";
    this.locomotion.setPath([]);
    this.propSockets.detachAll();

    if (this.currentCheckpointId) {
      checkpointManager.release(this.currentCheckpointId, this.config.id);
      this.currentCheckpointId = null;
    }

    this.syncBubble();
    this.notifyStateChange();

    if (this.isSeated) {
      this.isSeated = false;
      this.bubble?.setSeated(false);
      this.targetY = FLOOR_Y;
      this.animator.play("sitToStand", 0.18);
      this.scheduleTimer(() => {
        this.model.position.y = FLOOR_Y;
        this.animator.play("walking", 0.2);
        if (onReadyToWalk) onReadyToWalk();
      }, 650);
    } else {
      this.targetY = FLOOR_Y;
      this.model.position.y = FLOOR_Y;
      this.bubble?.setSeated(false);
      this.animator.play("walking", 0.2);
      if (onReadyToWalk) onReadyToWalk();
    }
  }

  navigateTo(destination, onArrival) {
    const path = Pathfinding.findPath(this.model.position, destination);
    this.locomotion.setPath(path, onArrival);
  }

  arriveAtStation(cp, overrideAction = null) {
    this.currentCheckpointId = cp.id;
    this.targetCheckpointId = null;
    this.model.position.set(cp.pos.x, this.model.position.y, cp.pos.z);
    this.model.rotation.y =
      this.overrideRotY !== null ? this.overrideRotY : cp.rotY;

    const isSeatedStation =
      cp.type === CHECKPOINT_TYPES.WORKSTATION ||
      cp.type === CHECKPOINT_TYPES.WAITING_SEAT ||
      cp.type === CHECKPOINT_TYPES.MEETING_SEAT;

    const chosenAction =
      overrideAction ||
      (cp.actions && cp.actions[0]) ||
      (isSeatedStation ? "sittingIdle" : "standingIdle");

    if (isSeatedStation) {
      const isHome = cp.id === this.homeCheckpointId;
      this.state = isHome ? "WORKING" : "INTERACTING";
      this.isSeated = true;
      this.targetY = cp.pos.y;
      this.animator.play("standToSit", 0.2);

      this.scheduleTimer(() => {
        this.model.position.y = cp.pos.y;
        if (isHome && chosenAction === "typing") {
          this.currentActionKey = "typing";
          this.currentActionLabel = "Tecleando código";
          this.propSockets.detachAll();
          this.animator.play("sitToType", 0.2);
          this.notifyStateChange();
        } else {
          this.applyActionProfile(chosenAction);
        }
      }, 620);
    } else {
      this.state = "INTERACTING";
      this.isSeated = false;
      this.targetY = FLOOR_Y;
      this.model.position.y = FLOOR_Y;
      this.applyActionProfile(chosenAction);
    }

    this.notifyStateChange();
  }

  arriveAtWaitingSeat(seat) {
    this.currentCheckpointId = seat.id;
    this.state = "WAITING";
    this.isSeated = true;
    this.targetY = seat.pos.y;
    this.model.position.set(seat.pos.x, this.model.position.y, seat.pos.z);
    this.model.rotation.y = seat.rotY;
    this.animator.play("standToSit", 0.2);

    this.scheduleTimer(() => {
      this.model.position.y = seat.pos.y;
      this.applyActionProfile("texting", { customLabel: "Esperando turno" });
    }, 620);

    this.notifyStateChange();
  }

  leaveWaitingSeatAndProceedToTarget() {
    const targetCP = checkpointManager.get(this.targetCheckpointId);
    if (!targetCP) return;

    this.beginTravel(() => {
      if (this.waitingSeatId) {
        checkpointManager.release(this.waitingSeatId, this.config.id);
        this.waitingSeatId = null;
      }
      this.navigateTo(targetCP.pos, () => {
        this.arriveAtStation(targetCP);
      });
    });
  }

  abandonWaitingAndReturnHome() {
    checkpointManager.removeFromQueue(this.targetCheckpointId, this.config.id);
    this.targetCheckpointId = null;
    this.returnHome();
  }

  returnHome() {
    if (!this.homeCheckpointId) return;
    const home = checkpointManager.get(this.homeCheckpointId);
    if (!home) return;

    this.clearTimers();
    this.clearSocialContext();
    this.taskAccentColor = null;
    checkpointManager.removeAgentFromAllQueues(this.config.id);
    if (this.waitingSeatId) {
      checkpointManager.release(this.waitingSeatId, this.config.id);
      this.waitingSeatId = null;
    }

    if (this.currentCheckpointId === this.homeCheckpointId && this.isSeated) {
      this.state = "WORKING";
      this.applyActionProfile("typing");
      return;
    }

    checkpointManager.reserve(this.homeCheckpointId, this.config.id);
    this.targetCheckpointId = this.homeCheckpointId;

    this.beginTravel(() => {
      this.navigateTo(home.pos, () => {
        this.arriveAtStation(home, "typing");
      });
    });
  }

  setDesktopStatus(status) {
    // WORKING | THINKING | IDLE
    if (this.currentCheckpointId !== this.homeCheckpointId) {
      this.returnHome();
      return;
    }

    this.clearTimers();
    this.state = status;

    if (status === "WORKING") {
      this.applyActionProfile("typing");
    } else if (status === "THINKING") {
      this.applyActionProfile("sittingDisbelief");
      this.currentActionLabel = "Analizando arquitectura";
      this.notifyStateChange();
    } else {
      this.applyActionProfile("sittingIdle");
    }
  }

  forcePreviewAction(actionKey) {
    const profile = ACTION_PROFILES[actionKey];
    if (!profile) return;

    this.clearTimers();
    this.clearSocialContext();
    this.taskAccentColor = null;
    this.locomotion.setPath([]);

    const seatedAnims = new Set([
      "typing",
      "sittingIdle",
      "sittingCheer",
      "sittingDisbelief",
      "sittingTalking",
      "sitToType",
      "typeToSit",
    ]);

    if (seatedAnims.has(profile.anim)) {
      if (!this.isSeated && this.currentCheckpointId !== this.homeCheckpointId) {
        this.returnHome();
        this.scheduleTimer(() => {
          this.state = "INTERACTING";
          this.applyActionProfile(actionKey);
        }, 1200);
        return;
      }
      this.state = actionKey === "typing" ? "WORKING" : "INTERACTING";
    } else {
      if (this.isSeated) {
        this.isSeated = false;
        this.targetY = FLOOR_Y;
        this.model.position.y = FLOOR_Y;
      }
      this.state = "INTERACTING";
    }

    this.applyActionProfile(actionKey);
  }

  getSnapshot() {
    const cp =
      checkpointManager.get(this.currentCheckpointId) ||
      checkpointManager.get(this.targetCheckpointId);

    return {
      id: this.config.id,
      name: this.config.name,
      role: this.config.role,
      color: this.config.color,
      directory: this.config.directory,
      state: this.state,
      animation: this.animator.currentAnimName || "typing",
      actionLabel: this.currentActionLabel,
      taskTitle: this.taskTitle,
      socialMode: this.socialMode,
      socialPartnerName: this.socialPartnerName,
      prop: this.propSockets.getActivePropLabel(),
      propKey: this.propSockets.activePropKey,
      zone: cp?.zone || "office",
      checkpointId:
        this.currentCheckpointId || this.targetCheckpointId || "corridor",
      isSeated: this.isSeated,
    };
  }

  notifyStateChange() {
    if (this.onUpdate) {
      this.onUpdate(this.config.id, this.getSnapshot());
    }
  }

  update(delta, allCharacters = []) {
    this.animator.update(delta);
    this.bubble?.update(delta);

    // Suavizado vertical para sentarse / levantarse sin saltos bruscos
    if (Math.abs(this.model.position.y - this.targetY) > 0.002) {
      this.model.position.y = THREE.MathUtils.damp(
        this.model.position.y,
        this.targetY,
        12,
        delta,
      );
    }

    if (this.state === "TRAVELING") {
      this.locomotion.updateProximity(allCharacters, this.config.id);
      this.locomotion.update(delta);
    }
  }

  destroy() {
    this.clearTimers();
    this.bubble?.dispose();
    this.propSockets.dispose();
  }
}
