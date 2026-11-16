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

    this.sensorRange = 1.05;
    this.avoidanceForce = new THREE.Vector3();
  }

  setPath(waypoints, onArrival = null) {
    this.waypoints = waypoints;
    this.currentWaypointIndex = 0;
    this.onArrival = onArrival;
  }

  updateProximity(allCharacters, currentAgentId) {
    this.avoidanceForce.set(0, 0, 0);
    if (this.waypoints.length === 0) return;

    const myPos = this.model.position;
    _myForward.set(0, 0, 1).applyAxisAngle(_upAxis, this.model.rotation.y);

    for (const other of allCharacters) {
      if (other.config.id === currentAgentId || !other.model) continue;
      const otherPos = other.model.position;
      const dist = myPos.distanceTo(otherPos);

      if (dist < this.sensorRange && dist > 0.001) {
        _toOther.subVectors(otherPos, myPos);
        _toOther.y = 0;
        _toOther.normalize();

        // Solo esquivar si el otro agente está delante o muy cerca lateralmente
        if (_myForward.dot(_toOther) > -0.25) {
          _lateral.set(-_myForward.z, 0, _myForward.x);
          const side = _lateral.dot(_toOther) >= 0 ? -1 : 1;
          const weight = (this.sensorRange - dist) / this.sensorRange;
          this.avoidanceForce.addScaledVector(_lateral, side * weight * 0.48);
        }
      }
    }
  }

  update(delta) {
    if (this.currentWaypointIndex >= this.waypoints.length) return;

    const target = this.waypoints[this.currentWaypointIndex];
    _dir.subVectors(target, this.model.position);
    _dir.y = 0;
    const distance = _dir.length();

    if (distance < 0.2) {
      this.currentWaypointIndex++;
      if (this.currentWaypointIndex >= this.waypoints.length) {
        if (this.onArrival) {
          const cb = this.onArrival;
          this.onArrival = null;
          cb();
        }
      }
      return;
    }

    _dir.normalize();
    _steerDir.copy(_dir).add(this.avoidanceForce).normalize();

    const targetAngle = Math.atan2(_steerDir.x, _steerDir.z);
    let diff = targetAngle - this.model.rotation.y;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    this.model.rotation.y += diff * Math.min(delta * 8.0, 1);

    this.model.position.x += _steerDir.x * this.speed * delta;
    this.model.position.z += _steerDir.z * this.speed * delta;
  }
}
