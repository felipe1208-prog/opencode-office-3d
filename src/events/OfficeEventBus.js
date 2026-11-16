export const OFFICE_EVENTS = {
  AGENT_STATE: "agent:state",
  AGENT_TASK: "agent:task",
  AGENT_NAVIGATE: "agent:navigate",
  AGENT_PROFILE_UPDATED: "agent:profile_updated",
  TASK_BOARD_SYNC: "task:board_sync",
  SOCIAL_PAIR_CHAT: "social:pair_chat",
  SOCIAL_DESK_REVIEW: "social:desk_review",
  OFFICE_MEETING: "office:meeting",
  OFFICE_LIGHTING: "office:lighting",
  OPENCODE_CONNECTION: "opencode:connection",
  OPENCODE_PERMISSION: "opencode:permission",
  OPENCODE_TASK_SYNC: "opencode:task_sync",
};

const MAX_HISTORY = 30;

export class OfficeEventBus {
  constructor() {
    this.listeners = new Map();
    this.history = [];
    this.seq = 0;
  }

  on(eventType, handler) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(handler);
    return () => this.off(eventType, handler);
  }

  off(eventType, handler) {
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(handler);
    }
  }

  emit(eventType, payload = {}, source = "system") {
    const entry = {
      id: ++this.seq,
      type: eventType,
      payload: { ...payload },
      source,
      timestamp: Date.now(),
    };

    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history.length = MAX_HISTORY;
    }

    const specific = this.listeners.get(eventType);
    if (specific) {
      for (const handler of specific) {
        handler(entry.payload, entry);
      }
    }

    const wildcard = this.listeners.get("*");
    if (wildcard) {
      for (const handler of wildcard) {
        handler(entry.payload, entry);
      }
    }

    return entry;
  }

  getHistory(limit = 20) {
    return this.history.slice(0, limit);
  }

  clearHistory() {
    this.history = [];
  }
}

export const officeEventBus = new OfficeEventBus();
