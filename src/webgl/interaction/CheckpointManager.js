import * as THREE from "three";
import { CHECKPOINTS, CHECKPOINT_TYPES } from "./checkpoints.config.js";

export class CheckpointManager {
  constructor() {
    this.checkpoints = JSON.parse(JSON.stringify(CHECKPOINTS));
    this.queues = new Map();
    this.listeners = new Map();

    Object.keys(this.checkpoints).forEach((id) => {
      this.queues.set(id, []);
    });
  }

  get(checkpointId) {
    return this.checkpoints[checkpointId] || null;
  }

  isAvailable(checkpointId) {
    const cp = this.checkpoints[checkpointId];
    return Boolean(cp && !cp.isOccupied && !cp.reservedBy);
  }

  getAvailableByIds(ids = []) {
    return ids
      .map((id) => this.checkpoints[id])
      .filter((cp) => cp && !cp.isOccupied && !cp.reservedBy);
  }

  getAvailableByType(type) {
    return Object.values(this.checkpoints).filter(
      (cp) => cp.type === type && !cp.isOccupied && !cp.reservedBy,
    );
  }

  reserve(checkpointId, agentId) {
    const cp = this.checkpoints[checkpointId];
    if (!cp) return false;

    if (cp.reservedBy === agentId) {
      cp.isOccupied = true;
      return true;
    }

    if (!cp.isOccupied && !cp.reservedBy) {
      cp.reservedBy = agentId;
      cp.isOccupied = true;
      return true;
    }

    const queue = this.queues.get(checkpointId);
    if (queue && !queue.includes(agentId)) {
      queue.push(agentId);
    }
    return false;
  }

  forceReserve(checkpointId, agentId) {
    const cp = this.checkpoints[checkpointId];
    if (!cp) return { ok: false, evictedAgentId: null };

    const previousHolder =
      cp.reservedBy && cp.reservedBy !== agentId ? cp.reservedBy : null;
    this.removeAgentFromAllQueues(agentId);
    cp.reservedBy = agentId;
    cp.isOccupied = true;
    return { ok: true, evictedAgentId: previousHolder };
  }

  releaseAllByAgent(agentId, { exceptCheckpointId = null } = {}) {
    if (!agentId) return;
    this.removeAgentFromAllQueues(agentId);
    for (const [id, cp] of Object.entries(this.checkpoints)) {
      if (id === exceptCheckpointId) continue;
      if (cp.reservedBy === agentId) {
        this.release(id, agentId);
      }
    }
  }

  release(checkpointId, agentId) {
    const cp = this.checkpoints[checkpointId];
    if (!cp) return;

    if (cp.reservedBy === agentId) {
      cp.isOccupied = false;
      cp.reservedBy = null;

      const queue = this.queues.get(checkpointId);
      if (queue && queue.length > 0) {
        const nextAgentId = queue.shift();
        cp.reservedBy = nextAgentId;
        cp.isOccupied = true;

        this.emit("turn:granted", {
          checkpointId,
          agentId: nextAgentId,
        });
      }
    }
  }

  removeFromQueue(checkpointId, agentId) {
    if (!checkpointId) return;
    const queue = this.queues.get(checkpointId);
    if (queue) {
      const idx = queue.indexOf(agentId);
      if (idx !== -1) {
        queue.splice(idx, 1);
      }
    }
  }

  removeAgentFromAllQueues(agentId) {
    for (const queue of this.queues.values()) {
      const idx = queue.indexOf(agentId);
      if (idx !== -1) queue.splice(idx, 1);
    }
  }

  getNearestAvailableWaitingSeat(fromPosition) {
    let nearestSeat = null;
    let minDistSq = Infinity;
    const fx = fromPosition.x;
    const fz = fromPosition.z;

    for (const cp of Object.values(this.checkpoints)) {
      if (
        cp.type === CHECKPOINT_TYPES.WAITING_SEAT &&
        !cp.isOccupied &&
        !cp.reservedBy
      ) {
        const dx = cp.pos.x - fx;
        const dz = cp.pos.z - fz;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDistSq) {
          minDistSq = distSq;
          nearestSeat = cp;
        }
      }
    }

    return nearestSeat;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const list = this.listeners.get(event);
    list.push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) {
      for (const cb of [...list]) cb(data);
    }
  }

  reset() {
    this.checkpoints = JSON.parse(JSON.stringify(CHECKPOINTS));
    this.queues.clear();
    Object.keys(this.checkpoints).forEach((id) => {
      this.queues.set(id, []);
    });
    this.listeners.clear();
  }
}

export const checkpointManager = new CheckpointManager();
