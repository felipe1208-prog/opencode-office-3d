import { officeEventBus, OFFICE_EVENTS } from "../events/OfficeEventBus.js";

export class AmbientAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambientGain = null;
    this.noiseSource = null;

    this.enabled = false;
    this.volume = 0.45;
    this.unsub = null;
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
    filter.frequency.value = 280;
    filter.Q.value = 0.7;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.055;

    src.connect(filter);
    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    src.start(0);
    this.noiseSource = src;
  }

  _bindBus() {
    if (this.unsub) return;
    this.unsub = officeEventBus.on("*", (payload, entry) => {
      if (!this.enabled) return;
      if (entry.type === OFFICE_EVENTS.AGENT_TASK) {
        if (payload.status === "passed") {
          this.playSuccessChime();
        } else if (payload.status === "failed") {
          this.playAlertPulse();
        } else {
          this.playSoftTick();
        }
      } else if (
        entry.type === OFFICE_EVENTS.SOCIAL_DESK_REVIEW ||
        entry.type === OFFICE_EVENTS.OFFICE_MEETING
      ) {
        this.playSoftTick();
      }
    });
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled);

    if (this.enabled) {
      if (!this._ensureContext()) {
        this.enabled = false;
        return false;
      }
      if (this.ctx.state === "suspended") {
        await this.ctx.resume().catch(() => {});
      }
      this._bindBus();
      this.masterGain.gain.setTargetAtTime(
        this.volume * 0.45,
        this.ctx.currentTime,
        0.08,
      );
      this.playSoftTick();
    } else if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06);
    }

    return this.enabled;
  }

  async toggle() {
    return this.setEnabled(!this.enabled);
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, Number(val) || 0));
    if (this.enabled && this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.volume * 0.45,
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  playSoftTick() {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(420, now + 0.045);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  playSuccessChime() {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const notes = [523.25, 783.99]; // C5 -> G5
    notes.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  playAlertPulse() {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const notes = [293.66, 261.63]; // D4 -> C4
    notes.forEach((freq, idx) => {
      const start = this.ctx.currentTime + idx * 0.11;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.075, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.22);
    });
  }

  dispose() {
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
