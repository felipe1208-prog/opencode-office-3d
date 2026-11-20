import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";

const AUDIO_MODE_STORAGE_KEY = "oficina3d:audio_mode:v1";
export const AUDIO_MODES = ["alerts", "ambient", "muted"];

function readSavedAudioMode() {
  try {
    if (typeof localStorage === "undefined") return "alerts";
    const raw = localStorage.getItem(AUDIO_MODE_STORAGE_KEY);
    return AUDIO_MODES.includes(raw) ? raw : "alerts";
  } catch {
    return "alerts";
  }
}

function saveAudioMode(mode) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(AUDIO_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignorar error de cuota
  }
}

export class AmbientAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambientGain = null;
    this.noiseSource = null;

    this.mode = readSavedAudioMode(); // "alerts" (default) | "ambient" | "muted"
    this.enabled = this.mode !== "muted";
    this.volume = 0.45;
    this.unsub = null;
    this.listeners = new Set();
    this.liveConnected = false;
    this._gestureHandler = null;
    this._lastChimeAt = 0;
  }

  init() {
    this._bindBus();
    this._bindFirstGestureUnlock();
    return this.getState();
  }

  getMode() {
    return this.mode;
  }

  getState() {
    return {
      mode: this.mode,
      enabled: this.mode !== "muted",
      ambientActive: this.mode === "ambient",
      volume: this.volume,
    };
  }

  onChange(fn) {
    if (typeof fn !== "function") return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notifyListeners() {
    const snap = this.getState();
    for (const fn of this.listeners) {
      try {
        fn(snap);
      } catch {
        // Ignorar errores de suscriptores
      }
    }
  }

  _bindFirstGestureUnlock() {
    if (typeof window === "undefined" || this._gestureHandler) return;
    this._gestureHandler = () => {
      if (this.mode !== "muted") {
        this._ensureContext();
        if (this.ctx?.state === "suspended") {
          this.ctx.resume().catch(() => {});
        }
        this._applyGainLevels();
      }
      if (this.ctx && this.ctx.state === "running") {
        this._unbindFirstGestureUnlock();
      }
    };
    window.addEventListener("pointerdown", this._gestureHandler, { passive: true });
    window.addEventListener("keydown", this._gestureHandler, { passive: true });
  }

  _unbindFirstGestureUnlock() {
    if (typeof window === "undefined" || !this._gestureHandler) return;
    window.removeEventListener("pointerdown", this._gestureHandler);
    window.removeEventListener("keydown", this._gestureHandler);
    this._gestureHandler = null;
  }

  _ensureContext() {
    if (this.ctx) return true;
    if (typeof window === "undefined") return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(this.ctx.destination);

    this._initAmbientBed();
    return true;
  }

  _initAmbientBed() {
    if (!this.ctx || this.noiseSource) return;

    // 3 segundos de ruido marrón suave en bucle (cero descargas externas)
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * 3;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 2.4;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 260;
    filter.Q.value = 0.7;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0;

    src.connect(filter);
    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    src.start(0);
    this.noiseSource = src;
  }

  _applyGainLevels() {
    if (!this.ctx || !this.masterGain || !this.ambientGain) return;
    const now = this.ctx.currentTime;
    const targetMaster = this.mode === "muted" ? 0 : this.volume * 0.45;
    const targetAmbient = this.mode === "ambient" ? 0.055 : 0;

    this.masterGain.gain.setTargetAtTime(targetMaster, now, 0.08);
    this.ambientGain.gain.setTargetAtTime(targetAmbient, now, 0.12);
  }

  _canPlayTone(minGapMs = 160) {
    if (this.mode === "muted") return false;
    if (!this.ctx || !this.masterGain || this.ctx.state !== "running") return false;
    const nowMs = Date.now();
    if (nowMs - this._lastChimeAt < minGapMs) return false;
    this._lastChimeAt = nowMs;
    return true;
  }

  _bindBus() {
    if (this.unsub) return;
    this.unsub = officeEventBus.on("*", (payload, entry) => {
      if (entry.type === OFFICE_EVENTS.OPENCODE_CONNECTION) {
        this.liveConnected = payload?.status === "connected";
        return;
      }

      if (this.mode === "muted") return;

      if (entry.type === OFFICE_EVENTS.OPENCODE_PERMISSION && payload?.added) {
        this.playPermissionAlert();
        return;
      }

      if (entry.type === OFFICE_EVENTS.OPENCODE_QUESTION && payload?.added) {
        this.playQuestionChime();
        return;
      }

      if (entry.type === OFFICE_EVENTS.OFFICE_PEER_REVIEW) {
        this.playSoftTick();
        return;
      }

      if (entry.type === OFFICE_EVENTS.AGENT_TASK) {
        // En modo en vivo solo reproducir avisos de trabajo real (nunca simulados)
        if (this.liveConnected && !payload?.live) return;
        if (payload?.status === "passed" && payload?.live) {
          this.playSuccessChime();
        } else if (payload?.status === "failed" && payload?.live) {
          this.playAlertPulse();
        }
      }
    });
  }

  async setMode(nextMode, { preview = true } = {}) {
    if (!AUDIO_MODES.includes(nextMode)) return this.getState();
    this.mode = nextMode;
    this.enabled = nextMode !== "muted";
    saveAudioMode(nextMode);
    this._bindBus();

    if (this.enabled) {
      if (this._ensureContext()) {
        if (this.ctx.state === "suspended") {
          await this.ctx.resume().catch(() => {});
        }
        this._applyGainLevels();
        if (preview) this.playSoftTick();
      }
    } else if (this.ctx && this.masterGain) {
      this._applyGainLevels();
    }

    this._notifyListeners();
    return this.getState();
  }

  async cycleMode() {
    const order = ["alerts", "ambient", "muted"];
    const next = order[(order.indexOf(this.mode) + 1) % order.length];
    return this.setMode(next, { preview: next !== "muted" });
  }

  async setEnabled(enabled) {
    return this.setMode(enabled ? "alerts" : "muted");
  }

  async toggle() {
    return this.cycleMode();
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, Number(val) || 0));
    this._applyGainLevels();
    this._notifyListeners();
  }

  playSoftTick() {
    if (!this._canPlayTone(80)) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.045);

    gain.gain.setValueAtTime(0.055, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playQuestionChime() {
    if (!this._canPlayTone(250)) return;
    const notes = [493.88, 659.25]; // B4 -> E5 cálido y atento
    notes.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.095;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.085, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.26);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.28);
    });
  }

  playSuccessChime() {
    if (!this._canPlayTone(250)) return;
    const notes = [523.25, 783.99]; // C5 -> G5
    notes.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.075, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  playAlertPulse() {
    if (!this._canPlayTone(250)) return;
    const notes = [293.66, 246.94]; // D4 -> B3
    notes.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.075, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  playPermissionAlert() {
    if (!this._canPlayTone(250)) return;
    const notes = [587.33, 880.0]; // D5 -> A5
    notes.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.085, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  }

  dispose() {
    this._unbindFirstGestureUnlock();
    this.unsub?.();
    this.unsub = null;
    try {
      this.noiseSource?.stop();
    } catch {
      // Ya detenido
    }
    this.noiseSource = null;
    this.ctx?.close?.().catch(() => {});
    this.ctx = null;
  }
}

export const ambientAudio = new AmbientAudioEngine();
