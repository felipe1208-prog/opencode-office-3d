import * as THREE from "three";

// Límites anatómicos reales: ±45° horizontal (0.785 rad), ±25° vertical (0.436 rad)
const MAX_YAW_RAD = THREE.MathUtils.degToRad(45);
const MAX_PITCH_RAD = THREE.MathUtils.degToRad(25);

const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _neckTargetQuat = new THREE.Quaternion();
const _headTargetQuat = new THREE.Quaternion();
const _deltaQuat = new THREE.Quaternion();
const _carryArmQuat = new THREE.Quaternion();
const _carryForeArmQuat = new THREE.Quaternion();
const _carryHandQuat = new THREE.Quaternion();

export class ProceduralIK {
  constructor() {
    this.neckQuat = new THREE.Quaternion();
    this.headQuat = new THREE.Quaternion();
    this.carryBlend = 0;

    // Estado de seguimiento de compañeros que pasan cerca (< 2.5m)
    this.passerbyTargetId = null;
    this.passerbyTrackTimer = 0;
    this.passerbyCooldown = 0;
    this.passerbyPos = new THREE.Vector3();
  }

  /**
   * Detecta si algún compañero que camina pasa a menos de 2.5m de un agente sentado
   * para activar un seguimiento visual natural de 1.5–2.5s antes de volver al monitor.
   */
  updatePasserbyTracking(agent, allCharacters, delta) {
    if (this.passerbyCooldown > 0) {
      this.passerbyCooldown = Math.max(0, this.passerbyCooldown - delta);
    }

    if (this.passerbyTrackTimer > 0) {
      this.passerbyTrackTimer = Math.max(0, this.passerbyTrackTimer - delta);
      if (this.passerbyTargetId && Array.isArray(allCharacters)) {
        const peer = allCharacters.find(
          (c) => c.config?.id === this.passerbyTargetId,
        );
        if (peer?.model) {
          this.passerbyPos.set(
            peer.model.position.x,
            peer.model.position.y + 1.48,
            peer.model.position.z,
          );
          return this.passerbyPos;
        }
      }
      this.passerbyTrackTimer = 0;
      this.passerbyTargetId = null;
    }

    // Solo escanear compañeros que pasan cuando el agente está trabajando sentado sin reunión activa
    if (
      !agent ||
      !agent.isSeated ||
      agent.state !== "WORKING" ||
      agent.socialMode ||
      this.passerbyCooldown > 0 ||
      !Array.isArray(allCharacters)
    ) {
      return null;
    }

    const myPos = agent.model.position;
    let closestPeer = null;
    let closestDistSq = 2.5 * 2.5; // Radio de 2.5m

    for (let i = 0; i < allCharacters.length; i++) {
      const other = allCharacters[i];
      if (!other || other.config?.id === agent.config?.id) continue;
      if (other.state !== "TRAVELING" || !other.model) continue;

      const dx = other.model.position.x - myPos.x;
      const dz = other.model.position.z - myPos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < closestDistSq && dSq > 0.25) {
        // Comprobar que el compañero esté dentro del hemisferio frontal/lateral (±115°)
        const worldYaw = Math.atan2(dx, dz);
        let relYaw = worldYaw - agent.model.rotation.y;
        while (relYaw < -Math.PI) relYaw += Math.PI * 2;
        while (relYaw > Math.PI) relYaw -= Math.PI * 2;
        if (Math.abs(relYaw) < 2.0) {
          closestDistSq = dSq;
          closestPeer = other;
        }
      }
    }

    if (closestPeer) {
      this.passerbyTargetId = closestPeer.config.id;
      this.passerbyTrackTimer = 1.6 + Math.random() * 0.85; // 1.6s a 2.45s
      this.passerbyCooldown = 7.5 + Math.random() * 4.5;
      this.passerbyPos.set(
        closestPeer.model.position.x,
        closestPeer.model.position.y + 1.48,
        closestPeer.model.position.z,
      );
      return this.passerbyPos;
    }

    return null;
  }

  /**
   * Aplica Look-At procedural sobre mixamorigNeck y mixamorigHead usando THREE.Quaternion.slerp
   * respetando los límites anatómicos (±45° yaw, ±25° pitch).
   */
  applyLookAtSlerp(bones, desiredYaw, desiredPitch, delta) {
    if (!bones) return;

    const clampedYaw = THREE.MathUtils.clamp(
      desiredYaw,
      -MAX_YAW_RAD,
      MAX_YAW_RAD,
    );
    const clampedPitch = THREE.MathUtils.clamp(
      desiredPitch,
      -MAX_PITCH_RAD,
      MAX_PITCH_RAD,
    );

    const slerpAlpha = 1 - Math.exp(-8.5 * delta);

    // Cuello absorbe 42% del giro horizontal y 38% del vertical
    _euler.set(clampedPitch * 0.38, clampedYaw * 0.42, 0, "YXZ");
    _neckTargetQuat.setFromEuler(_euler);
    this.neckQuat.slerp(_neckTargetQuat, slerpAlpha);

    // Cabeza absorbe 58% del giro horizontal y 62% del vertical
    _euler.set(clampedPitch * 0.62, clampedYaw * 0.58, 0, "YXZ");
    _headTargetQuat.setFromEuler(_euler);
    this.headQuat.slerp(_headTargetQuat, slerpAlpha);

    if (bones.neck) {
      bones.neck.quaternion.multiply(this.neckQuat);
    }
    if (bones.head) {
      bones.head.quaternion.multiply(this.headQuat);
    }
  }

  /**
   * Estabiliza el brazo y antebrazo izquierdo durante la marcha cuando el agente
   * transporta una taza de café o vaso de agua para que se mantenga nivelada sin volcarse.
   */
  applyCarryDrinkStabilizer(bones, isCarrying, procTime, delta) {
    const targetBlend = isCarrying ? 1 : 0;
    this.carryBlend = THREE.MathUtils.damp(
      this.carryBlend,
      targetBlend,
      10,
      delta,
    );
    if (this.carryBlend < 0.005 || !bones) return;

    const w = this.carryBlend;
    const microBob = Math.sin(procTime * 6.8) * 0.025;

    if (bones.leftArm) {
      _euler.set(-0.34 + microBob, -0.14, 0.16, "XYZ");
      _carryArmQuat.setFromEuler(_euler);
      bones.leftArm.quaternion.slerp(_carryArmQuat, 0.78 * w);
    }

    if (bones.leftForeArm) {
      _euler.set(-0.18, 0.62, -0.82 - microBob * 0.5, "XYZ");
      _carryForeArmQuat.setFromEuler(_euler);
      bones.leftForeArm.quaternion.slerp(_carryForeArmQuat, 0.85 * w);
    }

    if (bones.leftHand) {
      _euler.set(0.05, 0.08, 0.12, "XYZ");
      _carryHandQuat.setFromEuler(_euler);
      bones.leftHand.quaternion.slerp(_carryHandQuat, 0.72 * w);
    }
  }
}
