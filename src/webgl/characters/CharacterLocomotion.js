import * as THREE from "three";

const _dir = new THREE.Vector3();
const _steerDir = new THREE.Vector3();
const _toOther = new THREE.Vector3();
const _myForward = new THREE.Vector3();
const _lateral = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);

export class CharacterLocomotion {
  constructor(model, options = {}) {
    this.model = model;
    this.speed = options.speed || 0.85;
    this.waypoints = options.waypoints || [];
    this.currentWaypointIndex = 0;
    this.onArrival = options.onArrival || null;
    this.onPassingPeer = options.onPassingPeer || null;

    this.sensorRange = 1.05;
    this.greetingRange = 1.48;
    this.avoidanceForce = new THREE.Vector3();
    this.lookAheadYawOffset = 0;
    this._lastGreetedPeer = new Map(); // peerId -> timestamp ms
  }

  setPath(waypoints, onArrival = null) {
    this.waypoints = waypoints;
    this.currentWaypointIndex = 0;
    this.lookAheadYawOffset = 0;
    this.onArrival = onArrival;
  }

  updateProximity(allCharacters, currentAgentId) {
    this.avoidanceForce.set(0, 0, 0);
    if (
      this.waypoints.length === 0 ||
      this.currentWaypointIndex >= this.waypoints.length
    ) {
      return;
    }

    const myPos = this.model.position;
    const finalWp = this.waypoints[this.waypoints.length - 1];
    const distToFinal = Math.hypot(finalWp.x - myPos.x, finalWp.z - myPos.z);

    // Atenuar suavemente la evasión lateral al aproximarse al asiento/estación final
    // para no empujar al agente contra respaldos de sillas, escritorios o marcos de puerta.
    const approachScale =
      distToFinal < 0.95 ? Math.max(0, (distToFinal - 0.3) / 0.65) : 1.0;

    _myForward.set(0, 0, 1).applyAxisAngle(_upAxis, this.model.rotation.y);
    const now = performance.now();

    for (const other of allCharacters) {
      if (other.config.id === currentAgentId || !other.model) continue;
      const otherPos = other.model.position;
      const dx = otherPos.x - myPos.x;
      const dz = otherPos.z - myPos.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < this.greetingRange * this.greetingRange && distSq > 0.04) {
        const dist = Math.sqrt(distSq);
        _toOther.set(dx / dist, 0, dz / dist);
        const forwardDot = _myForward.dot(_toOther);

        // Micro-interacción de pasillo: saludo visual breve al cruzarse con otro compañero
        if (forwardDot > 0.15 && this.onPassingPeer) {
          const peerId = other.config.id;
          const lastAt = this._lastGreetedPeer.get(peerId) || 0;
          if (now - lastAt > 9000) {
            this._lastGreetedPeer.set(peerId, now);
            _lateral.set(-_myForward.z, 0, _myForward.x);
            const peerSide = _lateral.dot(_toOther) >= 0 ? 1 : -1;
            this.onPassingPeer(other, peerSide);
          }
        }

        if (approachScale > 0.05 && dist < this.sensorRange && forwardDot > -0.25) {
          _lateral.set(-_myForward.z, 0, _myForward.x);
          const side = _lateral.dot(_toOther) >= 0 ? -1 : 1;
          const weight = (this.sensorRange - dist) / this.sensorRange;
          this.avoidanceForce.addScaledVector(
            _lateral,
            side * weight * 0.45 * approachScale,
          );
        }
      }
    }
  }

  update(delta) {
    if (this.currentWaypointIndex >= this.waypoints.length) return;

    const isFinal = this.currentWaypointIndex === this.waypoints.length - 1;
    const arrivalRadius = isFinal ? 0.12 : 0.26;

    const target = this.waypoints[this.currentWaypointIndex];
    _dir.subVectors(target, this.model.position);
    _dir.y = 0;
    const distance = _dir.length();

    if (distance < arrivalRadius) {
      this.currentWaypointIndex++;
      if (this.currentWaypointIndex >= this.waypoints.length) {
        this.lookAheadYawOffset = 0;
        if (this.onArrival) {
          const cb = this.onArrival;
          this.onArrival = null;
          cb();
        }
      }
      return;
    }

    _dir.divideScalar(distance);
    _steerDir.copy(_dir).add(this.avoidanceForce);
    const steerLen = _steerDir.length();
    if (steerLen > 0.0001) {
      _steerDir.divideScalar(steerLen);
    } else {
      _steerDir.copy(_dir);
    }

    const targetAngle = Math.atan2(_steerDir.x, _steerDir.z);
    let diff = targetAngle - this.model.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.model.rotation.y += diff * (1 - Math.exp(-9.5 * delta));

    // Anticipación visual de curva: mirar hacia el siguiente waypoint antes de girar el torso
    if (!isFinal && distance < 0.95 && this.waypoints[this.currentWaypointIndex + 1]) {
      const nextWp = this.waypoints[this.currentWaypointIndex + 1];
      const nextAngle = Math.atan2(
        nextWp.x - this.model.position.x,
        nextWp.z - this.model.position.z,
      );
      let lookDiff = nextAngle - this.model.rotation.y;
      while (lookDiff < -Math.PI) lookDiff += Math.PI * 2;
      while (lookDiff > Math.PI) lookDiff -= Math.PI * 2;
      this.lookAheadYawOffset = THREE.MathUtils.clamp(lookDiff * 0.65, -0.58, 0.58);
    } else {
      this.lookAheadYawOffset = THREE.MathUtils.clamp(diff * 0.65, -0.55, 0.55);
    }

    // Desaceleración progresiva en los últimos 0.6m antes de llegar a una silla o estación
    let effectiveSpeed = this.speed;
    if (isFinal && distance < 0.6) {
      const ratio = THREE.MathUtils.clamp(
        (distance - arrivalRadius) / (0.6 - arrivalRadius),
        0,
        1,
      );
      effectiveSpeed = this.speed * THREE.MathUtils.lerp(0.45, 1.0, ratio);
    }

    const step = Math.min(effectiveSpeed * delta, isFinal ? distance : effectiveSpeed * delta);
    this.model.position.x += _steerDir.x * step;
    this.model.position.z += _steerDir.z * step;
  }
}
