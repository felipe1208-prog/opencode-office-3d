import * as THREE from "three";
import { ambientAudio } from "../../audio/AmbientAudioEngine.js";

const COFFEE_ZONE_POS = new THREE.Vector3(-1.53, 1.05, 6.1);
const PINGPONG_TABLE_POS = new THREE.Vector3(7.5, 0.78, -4.5);

const _camRight = new THREE.Vector3();
const _toSource = new THREE.Vector3();
const _camMatrix = new THREE.Matrix4();

export class AmbientAudioSystem {
  constructor(experience) {
    this.experience = experience;
    this.keyClickTimer = 0.08;
    this.coffeeBubbleTimer = 0.14;
    this.lastBallBounceIndex = -1;
  }

  /**
   * Calcula ganancia atenuada por distancia inversa suave y paneo estéreo (-1..1)
   * respecto a la cámara 3D actual, sin alojar vectores por frame.
   */
  _computeSpatialGainAndPan(cameraInstance, sourcePos, refDist = 3.2, maxDist = 16.5) {
    if (!cameraInstance || !sourcePos) {
      return { gain: 0, pan: 0 };
    }

    const dist = cameraInstance.position.distanceTo(sourcePos);
    if (dist >= maxDist) {
      return { gain: 0, pan: 0 };
    }

    // Atenuación suave cuadrática entre refDist y maxDist
    const norm = Math.max(0, (dist - refDist) / (maxDist - refDist));
    const gain = Math.pow(1 - norm, 1.85);

    _camMatrix.extractRotation(cameraInstance.matrixWorld);
    _camRight.set(1, 0, 0).applyMatrix4(_camMatrix).normalize();
    _toSource.subVectors(sourcePos, cameraInstance.position).normalize();
    const pan = THREE.MathUtils.clamp(_camRight.dot(_toSource) * 0.85, -0.9, 0.9);

    return { gain, pan };
  }

  _playSpatialKeyClick(gainFactor, panValue) {
    const ctx = ambientAudio.ctx;
    const master = ambientAudio.masterGain;
    if (!ctx || !master || ctx.state !== "running" || gainFactor < 0.04) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Variación natural de switch mecánico táctil (Brown/Red switch suave)
    const baseFreq = 1150 + Math.random() * 520;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(240 + Math.random() * 80, now + 0.018);

    const amp = 0.024 * gainFactor * (0.75 + Math.random() * 0.45);
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.022);

    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(panValue, now);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(master);
    } else {
      osc.connect(gain);
      gain.connect(master);
    }

    osc.start(now);
    osc.stop(now + 0.024);
  }

  _playSpatialCoffeeBubble(gainFactor, panValue, isSink = false) {
    const ctx = ambientAudio.ctx;
    const master = ambientAudio.masterGain;
    if (!ctx || !master || ctx.state !== "running" || gainFactor < 0.04) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Burbujeo cálido de cafetera espresso o murmullo de agua en fregadero
    const startFreq = isSink
      ? 360 + Math.random() * 220
      : 280 + Math.random() * 190;
    const endFreq = isSink ? startFreq * 0.85 : startFreq * 1.45;

    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.065);

    const amp = (isSink ? 0.018 : 0.026) * gainFactor;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(amp, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.072);

    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(panValue, now);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(master);
    } else {
      osc.connect(gain);
      gain.connect(master);
    }

    osc.start(now);
    osc.stop(now + 0.076);
  }

  _playSpatialPingPongBounce(gainFactor, panValue, isPaddleHit = false) {
    const ctx = ambientAudio.ctx;
    const master = ambientAudio.masterGain;
    if (!ctx || !master || ctx.state !== "running" || gainFactor < 0.03) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Rebote seco característico de pelota de celuloide sobre madera/pala
    const freq = isPaddleHit ? 940 + Math.random() * 60 : 1260 + Math.random() * 75;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.58, now + 0.038);

    const amp = 0.048 * gainFactor;
    gain.gain.setValueAtTime(amp, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.044);

    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(panValue, now);
      osc.connect(gain);
      gain.connect(panner);
      panner.connect(master);
    } else {
      osc.connect(gain);
      gain.connect(master);
    }

    osc.start(now);
    osc.stop(now + 0.048);
  }

  update(delta) {
    // Solo sintetizar audio espacial cuando el modo de audio incluye ambiente o avisos activos
    if (ambientAudio.getMode() === "muted") return;
    if (!ambientAudio.ctx || ambientAudio.ctx.state !== "running") return;

    const cam = this.experience?.camera?.instance;
    const world = this.experience?.world;
    if (!cam || !world) return;

    const isAmbientFull = ambientAudio.getMode() === "ambient";

    // 1. Teclas mecánicas sutiles cerca de los puestos de desarrollo con agentes en typing
    if (isAmbientFull && world.characters?.characters) {
      this.keyClickTimer -= delta;
      if (this.keyClickTimer <= 0) {
        // Cadencia orgánica con micro-pausas humanas
        this.keyClickTimer =
          Math.random() < 0.16
            ? 0.24 + Math.random() * 0.22
            : 0.075 + Math.random() * 0.075;

        let bestGain = 0;
        let bestPan = 0;
        for (const agent of world.characters.characters) {
          if (
            agent.isPhysicallyAtDesk() &&
            agent.currentActionKey === "typing" &&
            agent.state === "WORKING"
          ) {
            const { gain, pan } = this._computeSpatialGainAndPan(
              cam,
              agent.model.position,
              2.6,
              13.5,
            );
            if (gain > bestGain) {
              bestGain = gain;
              bestPan = pan;
            }
          }
        }
        if (bestGain > 0.04) {
          this._playSpatialKeyClick(bestGain, bestPan);
        }
      }
    }

    // 2. Burbujeo / vapor de cafetera o agua de fregadero en la cocina
    const coffeeArea = world.coffeeArea;
    if (
      coffeeArea &&
      (coffeeArea.espressoActive || coffeeArea.dripActive || coffeeArea.sinkActive)
    ) {
      this.coffeeBubbleTimer -= delta;
      if (this.coffeeBubbleTimer <= 0) {
        this.coffeeBubbleTimer = 0.11 + Math.random() * 0.12;
        const { gain, pan } = this._computeSpatialGainAndPan(
          cam,
          COFFEE_ZONE_POS,
          2.5,
          13.0,
        );
        if (gain > 0.04) {
          this._playSpatialCoffeeBubble(
            gain,
            pan,
            Boolean(coffeeArea.sinkActive && !coffeeArea.espressoActive),
          );
        }
      }
    }

    // 3. Rebote seco de pelota de ping-pong sincronizado con la física 3D de la mesa
    const rallyState = world.pingPong?.getRallyState?.();
    if (rallyState?.active) {
      // En PingPongArea, rallyPhase avanza a 5.4 rad/s; cada medio ciclo (PI / 2) hay impacto en pala o bote en mesa
      const stepIndex = Math.floor((rallyState.phase / (Math.PI * 0.5)));
      if (stepIndex !== this.lastBallBounceIndex) {
        this.lastBallBounceIndex = stepIndex;
        const isPaddleHit = stepIndex % 2 === 0;
        const { gain, pan } = this._computeSpatialGainAndPan(
          cam,
          rallyState.ballPos || PINGPONG_TABLE_POS,
          3.0,
          16.0,
        );
        if (gain > 0.03) {
          this._playSpatialPingPongBounce(gain, pan, isPaddleHit);
        }
      }
    } else {
      this.lastBallBounceIndex = -1;
    }
  }
}
