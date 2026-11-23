import * as THREE from "three";
import { configureTexture } from "../utils/SceneOptimizer.js";

const SEATED_LOCAL_Y = 1.44;
const STANDING_LOCAL_Y = 1.56;

export class AgentStatusBubble {
  constructor(model, agentConfig) {
    this.model = model;
    this.agentConfig = agentConfig;
    this.visible = false;
    this.targetY = SEATED_LOCAL_Y;

    this.canvas = document.createElement("canvas");
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext("2d");

    this.texture = configureTexture(new THREE.CanvasTexture(this.canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });

    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.name = `status-bubble-${agentConfig.id}`;
    this.sprite.center.set(0.5, 0);
    // Escala compensada respecto al model.scale = 1.14
    this.sprite.scale.set(1.08, 0.27, 1);
    this.sprite.position.set(0, SEATED_LOCAL_Y, 0);
    this.sprite.visible = false;

    this.lastText = "";
    this.lastStatusLabel = "Disponible";
    this.lastBadgeColor = agentConfig.color;

    if (this.model) {
      this.model.add(this.sprite);
    }

    this.setStatus("Disponible", agentConfig.color);
  }

  updateProfile(profile) {
    if (!profile) return;
    this.agentConfig = { ...this.agentConfig, ...profile };
    this.lastText = "";
    this.setStatus(this.lastStatusLabel, this.lastBadgeColor || this.agentConfig.color);
  }

  setStatus(text, accentColor = this.agentConfig.color, badgeTag = null) {
    const raw = String(text || "Disponible").replace(/\s+/g, " ").trim();
    const cleanText = raw.length > 44 ? `${raw.slice(0, 43)}…` : raw;
    const badgeColor = accentColor || this.agentConfig.color;
    this.lastStatusLabel = cleanText;
    this.lastBadgeColor = badgeColor;
    const key = `${cleanText}|${badgeColor}|${badgeTag || ""}`;
    if (key === this.lastText) return;
    this.lastText = key;

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const w = 420;
    const h = 104;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(cw / w, 0, 0, ch / h, 0, 0);

    // Fondo piedra oscura cálida translúcida con esquinas suaves
    const x = 10;
    const y = 8;
    const rw = w - 20;
    const rh = h - 24;
    const r = 16;

    ctx.fillStyle = "rgba(26, 23, 20, 0.9)";
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + rw - r, y);
    ctx.quadraticCurveTo(x + rw, y, x + rw, y + r);
    ctx.lineTo(x + rw, y + rh - r);
    ctx.quadraticCurveTo(x + rw, y + rh, x + rw - r, y + rh);
    ctx.lineTo(x + r, y + rh);
    ctx.quadraticCurveTo(x, y + rh, x, y + rh - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(245, 239, 230, 0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Puntero sutil inferior hacia la cabeza
    ctx.fillStyle = "rgba(26, 23, 20, 0.9)";
    ctx.beginPath();
    ctx.moveTo(w / 2 - 9, y + rh);
    ctx.lineTo(w / 2 + 9, y + rh);
    ctx.lineTo(w / 2, y + rh + 11);
    ctx.closePath();
    ctx.fill();

    // Marcador de identidad cromática izquierda
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(38, y + rh / 2, 8.5, 0, Math.PI * 2);
    ctx.fill();

    // Nombre del agente
    ctx.fillStyle = "#F5F1EA";
    ctx.font = "600 22px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(this.agentConfig.name, 60, y + 24);

    // Micro-icono / etiqueta contextual discreta en esquina superior derecha
    if (badgeTag) {
      const tagStr = String(badgeTag).trim();
      ctx.font = "600 17px 'Plus Jakarta Sans', system-ui, sans-serif";
      const tw = Math.max(30, ctx.measureText(tagStr).width + 16);
      const tx = x + rw - tw - 12;
      const ty = y + 10;
      const th = 26;
      const tr = 8;

      ctx.fillStyle = "rgba(255, 255, 255, 0.09)";
      ctx.beginPath();
      ctx.moveTo(tx + tr, ty);
      ctx.lineTo(tx + tw - tr, ty);
      ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + tr);
      ctx.lineTo(tx + tw, ty + th - tr);
      ctx.quadraticCurveTo(tx + tw, ty + th, tx + tw - tr, ty + th);
      ctx.lineTo(tx + tr, ty + th);
      ctx.quadraticCurveTo(tx, ty + th, tx, ty + th - tr);
      ctx.lineTo(tx, ty + tr);
      ctx.quadraticCurveTo(tx, ty, tx + tr, ty);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#F5F1EA";
      ctx.textAlign = "center";
      ctx.fillText(tagStr, tx + tw / 2, ty + th / 2 + 1);
      ctx.textAlign = "left";
    }

    // Subtítulo humano adaptativo
    const maxTextWidth = w - 82;
    let fontSize = 20;
    ctx.font = `500 ${fontSize}px 'Plus Jakarta Sans', system-ui, sans-serif`;
    while (fontSize > 16 && ctx.measureText(cleanText).width > maxTextWidth) {
      fontSize -= 1;
      ctx.font = `500 ${fontSize}px 'Plus Jakarta Sans', system-ui, sans-serif`;
    }

    let renderedText = cleanText;
    if (ctx.measureText(renderedText).width > maxTextWidth) {
      while (
        renderedText.length > 4 &&
        ctx.measureText(`${renderedText}…`).width > maxTextWidth
      ) {
        renderedText = renderedText.slice(0, -1);
      }
      renderedText = `${renderedText.trimEnd()}…`;
    }

    ctx.fillStyle =
      cleanText.startsWith("Esperando") || cleanText.startsWith("Necesita")
        ? "#FCD34D"
        : "#D8D1C7";
    ctx.fillText(renderedText, 60, y + 54);

    this.texture.needsUpdate = true;
  }

  setSeated(isSeated) {
    this.targetY = isSeated ? SEATED_LOCAL_Y : STANDING_LOCAL_Y;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.sprite.visible = this.visible;
  }

  update(delta) {
    if (!this.visible) return;
    if (Math.abs(this.sprite.position.y - this.targetY) > 0.004) {
      this.sprite.position.y = THREE.MathUtils.damp(
        this.sprite.position.y,
        this.targetY,
        10,
        delta,
      );
    }
  }

  dispose() {
    if (this.sprite.parent) {
      this.sprite.parent.remove(this.sprite);
    }
    this.texture.dispose();
    this.material.dispose();
  }
}
