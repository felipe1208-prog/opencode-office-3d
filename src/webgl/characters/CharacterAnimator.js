import * as THREE from "three";
import { ANIMATION_DEFS } from "./agents.config.js";
import { ProceduralIK } from "./ProceduralIK.js";

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

    // Semillas aleatorias individuales para desincronización total entre los 5 agentes
    this.timeOffset = Math.random() * 17.3;
    this.breathFreqScale = 0.88 + Math.random() * 0.24;

    // Capa procedural post-mixer + Cinemática Inversa (cero asignaciones por frame)
    this.bones = {};
    this.validNodeNames = new Set();
    this.ik = new ProceduralIK();
    this.proceduralMode = null;
    this.procTime = this.timeOffset;
    this.modeBlend = 0;
    this.isCarryingDrink = false;
    this.isThinkingPose = false;
    this.thinkingBlend = 0;

    // Gaze / seguimiento suave de cabeza (en radianes relativos al cuerpo)
    this.targetHeadYaw = 0;
    this.targetHeadPitch = 0;

    // Contexto dinámico externo (rally de ping-pong, saludo de pasillo)
    this.rallySide = null; // "north" | "south" | null
    this.rallyPhase = 0;
    this.rallyActive = false;
    this.greetingTimer = 0;
    this.greetingSide = 1;

    this._cacheSkeletonBones();
    this.initClips();
  }

  _cacheSkeletonBones() {
    if (!this.model) return;
    const matchers = {
      hips: /^(?:mixamorig[:_]?)?hips$/i,
      head: /^(?:mixamorig[:_]?)?head$/i,
      neck: /^(?:mixamorig[:_]?)?neck$/i,
      spine: /^(?:mixamorig[:_]?)?spine$/i,
      spine1: /^(?:mixamorig[:_]?)?spine1$/i,
      spine2: /^(?:mixamorig[:_]?)?spine2$/i,
      rightShoulder: /^(?:mixamorig[:_]?)?rightshoulder$/i,
      rightArm: /^(?:mixamorig[:_]?)?rightarm$/i,
      rightForeArm: /^(?:mixamorig[:_]?)?rightforearm$/i,
      rightHand: /^(?:mixamorig[:_]?)?righthand$/i,
      rightHandIndex1: /^(?:mixamorig[:_]?)?righthandindex1$/i,
      rightHandIndex2: /^(?:mixamorig[:_]?)?righthandindex2$/i,
      leftShoulder: /^(?:mixamorig[:_]?)?leftshoulder$/i,
      leftArm: /^(?:mixamorig[:_]?)?leftarm$/i,
      leftForeArm: /^(?:mixamorig[:_]?)?leftforearm$/i,
      leftHand: /^(?:mixamorig[:_]?)?lefthand$/i,
      leftHandIndex1: /^(?:mixamorig[:_]?)?lefthandindex1$/i,
      leftHandIndex2: /^(?:mixamorig[:_]?)?lefthandindex2$/i,
    };

    const assign = (node) => {
      const name = (node?.name || "").trim();
      if (!name) return;
      this.validNodeNames.add(name);
      for (const [key, regex] of Object.entries(matchers)) {
        if (!this.bones[key] && regex.test(name)) {
          this.bones[key] = node;
        }
      }
    };

    this.model.traverse((node) => {
      assign(node);
      if (node.isSkinnedMesh && node.skeleton) {
        for (const bone of node.skeleton.bones) {
          assign(bone);
        }
      }
    });
  }

  setProceduralMode(mode) {
    if (this.proceduralMode !== mode) {
      this.proceduralMode = mode || null;
      this.modeBlend = 0;
    }
  }

  setCarryingDrink(carrying) {
    this.isCarryingDrink = Boolean(carrying);
  }

  setThinkingPose(thinking) {
    this.isThinkingPose = Boolean(thinking);
  }

  setHeadGazeTarget(yawRad = 0, pitchRad = 0) {
    this.targetHeadYaw = THREE.MathUtils.clamp(yawRad, -0.785, 0.785);
    this.targetHeadPitch = THREE.MathUtils.clamp(pitchRad, -0.436, 0.436);
  }

  setPingPongRallyState({ active = false, phase = 0, side = null } = {}) {
    this.rallyActive = Boolean(active);
    this.rallyPhase = phase;
    this.rallySide = side;
  }

  triggerPassingGreeting(sideSign = 1) {
    this.greetingTimer = 1.15;
    this.greetingSide = sideSign >= 0 ? 1 : -1;
  }

  // Normaliza Mixamo: escala centímetros a metros (* 0.01), filtra huesos ausentes y neutraliza deriva de cadera
  retargetClip(clip, name) {
    if (!clip) return null;
    const retargeted = clip.clone();
    retargeted.name = name;

    const keptTracks = [];
    for (let tIdx = 0; tIdx < retargeted.tracks.length; tIdx++) {
      const track = retargeted.tracks[tIdx];
      track.name = track.name
        .replace(/.*mixamorig:?/i, "mixamorig")
        .replace(/^_*/, "");

      const dotIdx = track.name.indexOf(".");
      const nodeName = dotIdx > 0 ? track.name.slice(0, dotIdx) : track.name;
      if (this.validNodeNames.size > 0 && !this.validNodeNames.has(nodeName)) {
        continue;
      }

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
      keptTracks.push(track);
    }

    retargeted.tracks = keptTracks;
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

    if (
      this.currentAnimName === name &&
      this.currentAction === nextAction &&
      !onFinished &&
      nextAction.loop === THREE.LoopRepeat &&
      nextAction.isRunning()
    ) {
      return true;
    }

    if (onFinished) {
      this.oneShotCallbacks.set(name, onFinished);
    }

    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.fadeOut(duration);
    }

    nextAction.reset();
    // Desincronización orgánica en clips cíclicos para que ningún par de agentes se mueva al unísono
    if (nextAction.loop === THREE.LoopRepeat) {
      const clipDur = nextAction.getClip()?.duration || 2.0;
      if (clipDur > 0.4) {
        nextAction.time = (this.timeOffset * 0.73) % clipDur;
      }
    }
    nextAction.fadeIn(duration).play();
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

  _applyProceduralOverlay(delta) {
    const b = this.bones;
    const t = this.procTime;
    this.modeBlend = Math.min(1, this.modeBlend + delta * 3.8);
    const w = this.modeBlend;

    // 1. Respiración sutil orgánica desincronizada en torso
    const isOneShot =
      this.currentAnimName === "sitToStand" ||
      this.currentAnimName === "standToSit" ||
      this.currentAnimName === "sittingCheer" ||
      this.currentAnimName === "sittingDisbelief";

    if (!isOneShot && b.spine1) {
      const baseFreq = this.proceduralMode === "pingPongRally" ? 3.2 : 1.75;
      const breathFreq = baseFreq * this.breathFreqScale;
      const breathAmp = this.proceduralMode === "pingPongRally" ? 0.022 : 0.013;
      b.spine1.rotation.x += Math.sin(t * breathFreq) * breathAmp;
    }

    // 2. Micro-saludo de pasillo al cruzarse caminando
    let greetYaw = 0;
    let greetPitch = 0;
    if (this.greetingTimer > 0) {
      this.greetingTimer = Math.max(0, this.greetingTimer - delta);
      const env = Math.sin((this.greetingTimer / 1.15) * Math.PI);
      greetYaw = this.greetingSide * 0.34 * env;
      greetPitch = 0.12 * Math.sin(env * Math.PI);
      if (b.rightArm && this.currentAnimName === "walking") {
        b.rightArm.rotation.x -= 0.16 * env;
      }
    }

    // 2.5 Estabilizador de antebrazo izquierdo al transportar taza o vaso caminando
    this.ik.applyCarryDrinkStabilizer(
      b,
      this.isCarryingDrink && this.currentAnimName === "walking",
      t,
      delta,
    );

    // 3. Seguimiento suave de mirada (Look-At IK en cuello + cabeza con Quaternion.slerp)
    let autoYaw = 0;
    let autoPitch = 0;
    const mode = this.proceduralMode;

    if (!isOneShot) {
      if (mode === "typingScan") {
        // Escaneo natural entre monitor izquierdo, código central y monitor derecho
        autoYaw = Math.sin(t * 0.58) * 0.19 + Math.sin(t * 1.25) * 0.045;
        autoPitch = 0.05 + Math.sin(t * 0.9) * 0.035;
      } else if (mode === "listeningNod" || mode === "conversing") {
        autoPitch = Math.max(0, Math.sin(t * 2.1)) * 0.095;
        autoYaw = Math.sin(t * 0.68) * 0.08;
      } else if (mode === "presentingSweep") {
        autoYaw = Math.sin(t * 0.72) * 0.32;
        autoPitch = 0.04 + Math.sin(t * 1.4) * 0.03;
      } else if (mode === "relaxedWatch") {
        autoYaw = Math.sin(t * 0.35) * 0.07;
        autoPitch = -0.04;
      } else if (mode === "inspectCurious") {
        autoYaw = Math.sin(t * 0.8) * 0.24;
        autoPitch = -0.08 + Math.sin(t * 0.55) * 0.09;
      } else if (mode === "textingGlance" || mode === "seatedSmartphoneUse") {
        autoPitch = 0.22 + Math.sin(t * 1.6) * 0.03;
        autoYaw = Math.sin(t * 0.9) * 0.04;
      } else if (mode === "coffeeBrew") {
        autoPitch = 0.12 + Math.sin(t * 1.2) * 0.05;
        autoYaw = Math.sin(t * 0.85) * 0.08;
      } else if (mode === "washHands") {
        autoPitch = 0.24;
        autoYaw = Math.sin(t * 1.5) * 0.05;
      }
    }

    if (!isOneShot) {
      this.ik.applyLookAtSlerp(
        b,
        this.targetHeadYaw + autoYaw + greetYaw,
        this.targetHeadPitch + autoPitch + greetPitch,
        delta,
      );
    }

    if (isOneShot || !mode) return;

    // 4. Acciones procedurales dedicadas sobre tren superior, brazos y manos
    if (mode === "typingScan") {
      this.thinkingBlend = THREE.MathUtils.damp(
        this.thinkingBlend,
        this.isThinkingPose ? 1 : 0,
        5.5,
        delta,
      );
      const thinkW = this.thinkingBlend * w;
      const typeW = (1 - this.thinkingBlend) * w;

      // A) Postura pensativa (mano en la barbilla / leve inclinación leyendo código en THINKING)
      if (thinkW > 0.01) {
        if (b.spine1) {
          b.spine1.rotation.x -= 0.065 * thinkW;
        }
        if (b.rightArm) {
          b.rightArm.rotation.x -= 0.42 * thinkW;
          b.rightArm.rotation.y += 0.24 * thinkW;
        }
        if (b.rightForeArm) {
          b.rightForeArm.rotation.y -= 0.68 * thinkW;
          b.rightForeArm.rotation.x -= 0.22 * thinkW;
        }
        if (b.head) {
          b.head.rotation.z += 0.055 * thinkW;
        }
      }

      // B) Ciclo realista de programador: ráfagas de tecleo + uso del mouse + micro-estiramiento de cuello
      if (typeW > 0.01) {
        const mouseCycle = Math.sin(t * 0.68);
        const onMouse = THREE.MathUtils.smoothstep(mouseCycle, 0.38, 0.78) * typeW;
        const burstEnv = 0.65 + 0.35 * Math.sin(t * 1.9);
        const keyFlutterL = Math.sin(t * 13.5) * 0.068 * burstEnv * typeW;
        const keyFlutterR =
          Math.cos(t * 14.2) * 0.068 * burstEnv * (1 - onMouse * 0.75) * typeW;
        const mouseClick =
          Math.pow(Math.max(0, Math.sin(t * 4.8)), 6) * 0.14 * onMouse;

        // Micro-giro relajante de cuello/hombros cada ~24s
        const neckRoll = Math.pow(Math.max(0, Math.sin(t * 0.26)), 10) * typeW;
        if (neckRoll > 0.01 && b.head) {
          b.head.rotation.z += Math.sin(t * 2.8) * 0.085 * neckRoll;
        }

        if (b.rightArm) {
          b.rightArm.rotation.z -= 0.14 * onMouse;
          b.rightArm.rotation.y -= 0.11 * onMouse;
        }
        if (b.rightForeArm) {
          b.rightForeArm.rotation.y -= 0.16 * onMouse;
          b.rightForeArm.rotation.x += Math.sin(t * 2.4) * 0.03 * onMouse;
        }
        if (b.rightHandIndex1) {
          b.rightHandIndex1.rotation.x += keyFlutterR + mouseClick;
        }
        if (b.leftHandIndex1) {
          b.leftHandIndex1.rotation.x += keyFlutterL;
        }
      }
      return;
    }

    if (mode === "seatedSmartphoneUse") {
      // Sentado en sofá/puff/espera usando el smartphone con ambas manos frente al pecho
      const thumbScroll = Math.sin(t * 4.2) * 0.09 * w;
      if (b.spine1) {
        b.spine1.rotation.x += 0.08 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x -= 0.54 * w;
        b.rightArm.rotation.y += 0.26 * w;
        b.rightArm.rotation.z += 0.12 * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y -= 0.72 * w;
        b.rightForeArm.rotation.x += (-0.18 + thumbScroll * 0.5) * w;
      }
      if (b.rightHandIndex1) {
        b.rightHandIndex1.rotation.x += thumbScroll * 1.4;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.44 * w;
        b.leftArm.rotation.y -= 0.22 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += 0.58 * w;
      }
      return;
    }

    if (mode === "pingPongRally") {
      // Swing sincronizado con la fase del rally de la pelota 3D
      const phaseOffset = this.rallySide === "south" ? Math.PI : 0;
      const p = this.rallyActive ? this.rallyPhase + phaseOffset : t * 2.6;
      const swingWave = Math.sin(p);
      const hitPulse = Math.pow(Math.max(0, Math.cos(p)), 3);

      if (b.spine) {
        b.spine.rotation.x += 0.14 * w; // Postura atlética ligeramente inclinada hacia la mesa
      }
      if (b.spine1) {
        b.spine1.rotation.y += swingWave * 0.22 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x += (-0.58 - hitPulse * 0.48) * w;
        b.rightArm.rotation.z += (-0.28 + swingWave * 0.32) * w;
        b.rightArm.rotation.y += (0.18 + swingWave * 0.35) * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y += (-0.65 - hitPulse * 0.45) * w;
        b.rightForeArm.rotation.x += (-0.25 + swingWave * 0.22) * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x += (-0.24 + swingWave * 0.12) * w;
        b.leftArm.rotation.z += 0.18 * w;
      }
      return;
    }

    if (mode === "victoryPump") {
      const pump = Math.sin(t * 7.5);
      if (b.spine1) {
        b.spine1.rotation.x -= 0.08 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x += (-1.35 + pump * 0.28) * w;
        b.rightArm.rotation.z += -0.22 * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y += (-0.75 + pump * 0.2) * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x += (-0.85 - pump * 0.18) * w;
        b.leftArm.rotation.z += 0.22 * w;
      }
      return;
    }

    if (mode === "whiteboardWrite") {
      // Mano derecha traza diagramas en pizarra mientras mano izquierda sostiene cuaderno de referencia
      const lineSweep = Math.sin(t * 1.45);
      const scribble = Math.sin(t * 6.2) * 0.065;
      if (b.spine1) {
        b.spine1.rotation.y += lineSweep * 0.09 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x += (-1.18 + scribble) * w;
        b.rightArm.rotation.y += (0.14 + lineSweep * 0.24) * w;
        b.rightArm.rotation.z += -0.18 * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y += (-0.52 + Math.cos(t * 3.1) * 0.12) * w;
        b.rightForeArm.rotation.x += -0.18 * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.42 * w;
        b.leftArm.rotation.y -= 0.16 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += 0.54 * w;
      }
      if (b.head) {
        b.head.rotation.x += (-0.06 + scribble * 0.4) * w;
        b.head.rotation.y += lineSweep * 0.14 * w;
      }
      return;
    }

    if (mode === "arcadePlay") {
      // Ambas manos apoyadas sobre el panel de control de la recreativa (y ≈ 1.03m)
      const mash = Math.sin(t * 12.5);
      const stick = Math.sin(t * 4.8);
      if (b.spine1) {
        b.spine1.rotation.x += 0.09 * w;
        b.spine1.rotation.z += stick * 0.045 * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.48 * w;
        b.leftArm.rotation.y -= 0.14 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += (0.52 + stick * 0.16) * w;
        b.leftForeArm.rotation.x += Math.cos(t * 3.6) * 0.08 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x += 0.12 * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.x += mash * 0.11 * w;
      }
      if (b.rightHandIndex1) {
        b.rightHandIndex1.rotation.x += Math.abs(mash) * 0.22 * w;
      }
      return;
    }

    if (mode === "stretchSeated" || mode === "stretchStanding") {
      // Estiramiento ergonómico de hombros y brazos con fase de relajación
      const cycle = Math.max(0, Math.sin(t * 1.05));
      const arch = cycle * w;
      if (b.spine1) {
        b.spine1.rotation.x -= 0.16 * arch;
      }
      if (b.spine2) {
        b.spine2.rotation.x -= 0.1 * arch;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x -= 1.32 * arch;
        b.rightArm.rotation.z -= 0.34 * arch;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 1.32 * arch;
        b.leftArm.rotation.z += 0.34 * arch;
      }
      if (b.head) {
        b.head.rotation.x -= 0.14 * arch;
      }
      return;
    }

    if (mode === "deskCoffeeSip") {
      // Ciclo suave: levantar la taza hacia la boca, mantener sorbo y bajar
      const phase = (t * 0.55) % (Math.PI * 2);
      const lift = Math.max(0, Math.sin(phase));
      const sip = Math.pow(lift, 1.6) * w;
      if (b.rightArm) {
        b.rightArm.rotation.x -= 0.72 * sip;
        b.rightArm.rotation.y += 0.22 * sip;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y -= 0.85 * sip;
      }
      if (b.head) {
        b.head.rotation.x += 0.12 * sip;
      }
      return;
    }

    if (mode === "relaxedWatch") {
      // Viendo TV en el Lounge: mano derecha apunta periódicamente con el control remoto, mano izquierda sostiene taza
      const zapPulse = Math.pow(Math.max(0, Math.sin(t * 0.65)), 5) * w;
      if (b.spine) {
        b.spine.rotation.x -= 0.06 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x -= 0.42 * zapPulse;
        b.rightArm.rotation.y += 0.12 * zapPulse;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y -= 0.35 * zapPulse;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.22 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += 0.32 * w;
      }
      return;
    }

    if (mode === "takeNotes" || mode === "listeningNod") {
      // Mano izquierda sostiene cuaderno abierto; mano derecha escribe activamente con el bolígrafo
      const writeIntensity = mode === "takeNotes" ? 1.0 : 0.45;
      const jotX = Math.sin(t * 6.4) * 0.075 * writeIntensity * w;
      const lineProgress = Math.sin(t * 1.1) * 0.09 * writeIntensity * w;
      if (b.head && mode === "takeNotes") {
        const lookUp = Math.pow(Math.max(0, Math.sin(t * 0.45)), 4);
        b.head.rotation.x += 0.18 * (1 - lookUp) * w;
        b.head.rotation.y -= 0.08 * (1 - lookUp) * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.48 * w;
        b.leftArm.rotation.y -= 0.2 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += 0.56 * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x -= 0.54 * w;
        b.rightArm.rotation.y += (0.26 + lineProgress) * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y -= 0.62 * w;
        b.rightForeArm.rotation.x += jotX;
      }
      return;
    }

    if (mode === "coffeeBrew") {
      // Mano izquierda sostiene taza junto a la bandeja de goteo mientras mano derecha opera el portafiltro/botones
      const adjust = Math.sin(t * 3.4) * 0.08 * w;
      if (b.spine1) {
        b.spine1.rotation.x += 0.08 * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.48 * w;
        b.leftArm.rotation.y -= 0.14 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += 0.52 * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y += adjust;
      }
      return;
    }

    if (mode === "washHands") {
      // Ambas manos extendidas juntas bajo el chorro del grifo cuello de cisne frotándose
      const rub = Math.sin(t * 5.8) * 0.11 * w;
      if (b.spine1) {
        b.spine1.rotation.x += 0.12 * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.56 * w;
        b.leftArm.rotation.y -= 0.24 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += (0.58 - rub) * w;
      }
      if (b.rightArm) {
        b.rightArm.rotation.x += 0.14 * w;
        b.rightArm.rotation.y += 0.18 * w;
      }
      if (b.rightForeArm) {
        b.rightForeArm.rotation.y += rub;
      }
      return;
    }

    if (mode === "vendingTap" || mode === "reachCabinet") {
      // Pulsar botones del teclado lateral / tirador de puerta y recoger bebida con mano izquierda
      const bendCycle = Math.pow(Math.max(0, Math.sin(t * 0.75 - 0.8)), 4) * w;
      if (b.spine1) {
        b.spine1.rotation.x += (0.06 + bendCycle * 0.18) * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= (0.36 + bendCycle * 0.22) * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += 0.48 * w;
      }
      return;
    }

    if (mode === "deskReviewGestures" || mode === "inspectCurious" || mode === "presentingSweep") {
      const gesture = Math.sin(t * 2.2) * 0.08 * w;
      if (b.spine1) {
        b.spine1.rotation.x += 0.06 * w;
      }
      if (b.leftArm) {
        b.leftArm.rotation.x -= 0.42 * w;
      }
      if (b.leftForeArm) {
        b.leftForeArm.rotation.y += (0.48 + gesture) * w;
      }
    }
  }

  update(delta) {
    const dt = Math.min(delta, 0.05);
    this.procTime += dt;
    this.mixer.update(dt);
    this._applyProceduralOverlay(dt);
  }
}
