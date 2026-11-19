import * as THREE from "three";
import { AGENT_STATIONS } from "../../config/officeLayout.js";
import { configureTexture } from "../utils/SceneOptimizer.js";

const CHECKPOINT_TO_AGENT = Object.values(AGENT_STATIONS).reduce((acc, st) => {
  acc[st.checkpointId] = st;
  return acc;
}, {});

const ROLE_SNIPPETS = {
  architect: {
    file: "architecture/office-graph.ts",
    lines: [
      "export interface AgentDirective {",
      "  zone: ZoneId; priority: 1 | 2 | 3;",
      "  syncState(bus: OfficeEventBus): void;",
      "}",
      "const graph = buildNavMesh(zones);",
      "assert(reachableNodes === 47);",
    ],
    metricTitle: "SYSTEM TOPOLOGY",
    metricSub: "5 agents · 47 checkpoints · 0 faults",
  },
  frontend: {
    file: "src/webgl/shaders/MonitorPass.ts",
    lines: [
      "const tex = new CanvasTexture(canvas);",
      "tex.colorSpace = SRGBColorSpace;",
      "mat.emissiveIntensity = lerp(0.28, 0.95, t);",
      "sprite.position.y = damp(y, targetY, 10);",
      "renderer.toneMappingExposure = 1.04;",
      "requestAnimationFrame(renderLoop);",
    ],
    metricTitle: "WEBGL PIPELINE",
    metricSub: "60 FPS · sRGB · DPR 2x",
  },
  qa: {
    file: "tests/nav-integrity.spec.ts",
    lines: [
      "describe('A* NavGraph Integrity', () => {",
      "  it('reaches all 47 checkpoints', () => {",
      "    for (const cp of CHECKPOINTS) {",
      "      expect(findPath(home, cp)).toBeDefined();",
      "    }",
      "  }); // 47/47 passed",
    ],
    metricTitle: "RELIABILITY SUITE",
    metricSub: "100% pass · Latency 4.2ms",
  },
  backend: {
    file: "src/events/OfficeEventBus.ts",
    lines: [
      "bus.on('agent:task', async (ev) => {",
      "  await scheduler.assign(ev.agentId);",
      "  checkpointMgr.reserve(ev.target);",
      "  emitSnapshot(ev.agentId, 'WORKING');",
      "});",
      "// Event stream synchronized",
    ],
    metricTitle: "EVENT BUS TELEMETRY",
    metricSub: "Queue: 0 · Throughput: nominal",
  },
  systems: {
    file: "cli/opencode-adapter.ts",
    lines: [
      "const watcher = watchWorkspace(VAULT_DIR);",
      "watcher.on('change', (patch) => {",
      "  bus.emit('agent:task', normalize(patch));",
      "});",
      "await spawnWorker({ sandbox: true });",
      "// Daemon standby ready",
    ],
    metricTitle: "CLI DAEMON HOOK",
    metricSub: "Adapter ready · Live SSE",
  },
};

export class MonitorScreenSystem {
  constructor() {
    this.stationScreens = new Map();
    this.standbyTexture = null;
    this.standbyMaterial = null;
    this.standbyMaterials = [];
    this.meetingScreen = null;
    this.whiteboardScreen = null;
    this.whiteboardNotes = [];
    this.loungeScreen = null;
    this.nightFactor = -1;
    this.tickCounter = 0;
  }

  _getStandbyTexture() {
    if (this.standbyTexture) return this.standbyTexture;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(512 / 512, 0, 0, 256 / 320, 0, 0);

    const grad = ctx.createLinearGradient(0, 0, 512, 320);
    grad.addColorStop(0, "#090E1A");
    grad.addColorStop(1, "#111A2E");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 320);

    ctx.strokeStyle = "rgba(56, 189, 248, 0.16)";
    ctx.lineWidth = 2;
    ctx.strokeRect(24, 24, 464, 272);

    ctx.fillStyle = "#64748B";
    ctx.font = "600 20px monospace";
    ctx.fillText("ESTACIÓN EN ESPERA", 142, 152);
    ctx.fillStyle = "#334155";
    ctx.font = "15px monospace";
    ctx.fillText("OFICINA VIRTUAL 3D · LISTO", 136, 184);

    const tex = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });
    this.standbyTexture = tex;
    return tex;
  }

  _getStandbyMaterial() {
    if (this.standbyMaterial) return this.standbyMaterial;
    const tex = this._getStandbyTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color("#FFFFFF"),
      emissiveMap: tex,
      emissiveIntensity: 0.14,
      roughness: 0.16,
      metalness: 0.08,
    });
    mat.userData = { keepMaterialInstance: true };
    this.standbyMaterial = mat;
    this.standbyMaterials = [mat];
    return mat;
  }

  _ensureStationEntry(stationKey) {
    if (this.stationScreens.has(stationKey)) {
      return this.stationScreens.get(stationKey);
    }

    const agentConfig = CHECKPOINT_TO_AGENT[stationKey] || null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    const texture = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });

    const rightCanvas = document.createElement("canvas");
    rightCanvas.width = 512;
    rightCanvas.height = 256;
    const rightCtx = rightCanvas.getContext("2d");

    const rightTexture = configureTexture(new THREE.CanvasTexture(rightCanvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });

    const entry = {
      stationKey,
      agentConfig,
      mode: agentConfig ? "WORKING" : "STANDBY",
      taskLabel: agentConfig ? "Tecleando código" : "Disponible",
      taskFile: agentConfig
        ? ROLE_SNIPPETS[agentConfig.id]?.file || "workspace/index.ts"
        : "standby",
      partnerName: null,
      canvas,
      ctx,
      texture,
      rightCanvas,
      rightCtx,
      rightTexture,
      materials: [],
      dirty: true,
      lastRenderKey: null,
    };

    this.stationScreens.set(stationKey, entry);
    this._redrawStation(entry);
    return entry;
  }

  attachWorkstationMonitor(monitorWrapper, { stationKey, screenIndex = 0 }) {
    if (!monitorWrapper) return null;

    let screenMesh = null;
    monitorWrapper.traverse((child) => {
      if (
        child.isMesh &&
        (child.name === "computerScreen_1" ||
          child.name.toLowerCase().includes("_1"))
      ) {
        screenMesh = child;
      }
    });

    // Asegurar matriz local limpia temporalmente para medir computerScreen_1
    const prevPos = monitorWrapper.position.clone();
    const prevRot = monitorWrapper.rotation.clone();
    monitorWrapper.position.set(0, 0, 0);
    monitorWrapper.rotation.set(0, 0, 0);
    monitorWrapper.updateMatrixWorld(true);

    const targetBox = new THREE.Box3().setFromObject(
      screenMesh || monitorWrapper,
    );
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    targetBox.getSize(size);
    targetBox.getCenter(center);

    monitorWrapper.position.copy(prevPos);
    monitorWrapper.rotation.copy(prevRot);
    monitorWrapper.updateMatrixWorld(true);

    const planeW = Math.max(0.22, size.x * 0.94);
    const planeH = Math.max(
      0.14,
      Math.hypot(size.y, size.z) * (screenMesh ? 0.9 : 0.72),
    );

    const isAssigned = Boolean(CHECKPOINT_TO_AGENT[stationKey]);
    let entry = null;
    let mat;

    if (isAssigned) {
      entry = this._ensureStationEntry(stationKey);
      const tex = screenIndex === 0 ? entry.texture : entry.rightTexture;
      mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissive: new THREE.Color("#FFFFFF"),
        emissiveMap: tex,
        emissiveIntensity: 0.3,
        roughness: 0.16,
        metalness: 0.08,
      });
      entry.materials.push(mat);
    } else {
      mat = this._getStandbyMaterial();
    }

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
    plane.name = `monitor-screen-${stationKey}-${screenIndex}`;

    // Normal del panel computerScreen_1: (0, 0.13917, -0.99027)
    const tiltX = Math.atan2(0.139173, 0.990268);
    plane.rotation.order = "YXZ";
    plane.rotation.y = Math.PI;
    plane.rotation.x = -tiltX;

    // Desplazar 3mm hacia delante siguiendo la normal del panel (-Z, +Y)
    plane.position.set(center.x, center.y + 0.0005, center.z - 0.003);
    plane.castShadow = false;
    plane.receiveShadow = false;

    if (isAssigned) {
      plane.userData.noBatch = true;
    } else {
      plane.userData.keepMaterialInstance = true;
    }

    monitorWrapper.add(plane);
    return plane;
  }

  registerMeetingTV(screenMesh) {
    if (!screenMesh) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    const texture = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: new THREE.Color("#FFFFFF"),
      emissiveMap: texture,
      emissiveIntensity: 0.32,
      roughness: 0.14,
      metalness: 0.1,
    });

    screenMesh.material = mat;
    screenMesh.userData.noBatch = true;
    this.meetingScreen = {
      mesh: screenMesh,
      material: mat,
      canvas,
      ctx,
      texture,
      mode: "STANDBY", // STANDBY | MEETING
      topic: "Sprint Sync · Oficina Virtual 3D",
      presenterName: "Tech Lead",
      lastRenderKey: null,
    };

    this._redrawMeetingTV();
  }

  registerMeetingWhiteboard(boardWrapper) {
    if (!boardWrapper) return;

    const prevPos = boardWrapper.position.clone();
    const prevRot = boardWrapper.rotation.clone();
    boardWrapper.position.set(0, 0, 0);
    boardWrapper.rotation.set(0, 0, 0);
    boardWrapper.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(boardWrapper);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    boardWrapper.position.copy(prevPos);
    boardWrapper.rotation.copy(prevRot);
    boardWrapper.updateMatrixWorld(true);

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");

    const texture = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.42,
      metalness: 0.02,
    });

    const planeW = Math.max(1.0, size.x * 0.9);
    const planeH = Math.max(0.6, size.y * 0.78);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
    plane.name = "meeting-kanban-whiteboard-surface";
    plane.position.set(center.x, center.y + size.y * 0.03, box.max.z + 0.004);
    plane.castShadow = false;
    plane.receiveShadow = true;
    plane.userData.noBatch = true;
    boardWrapper.add(plane);

    this.whiteboardScreen = {
      mesh: plane,
      material: mat,
      canvas,
      ctx,
      texture,
      lastRenderKey: null,
    };

    this._redrawMeetingWhiteboard();
  }

  registerLoungeTV(tvWrapper) {
    if (!tvWrapper) return;

    const prevPos = tvWrapper.position.clone();
    const prevRot = tvWrapper.rotation.clone();
    tvWrapper.position.set(0, 0, 0);
    tvWrapper.rotation.set(0, 0, 0);
    tvWrapper.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(tvWrapper);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    tvWrapper.position.copy(prevPos);
    tvWrapper.rotation.copy(prevRot);
    tvWrapper.updateMatrixWorld(true);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    const texture = configureTexture(new THREE.CanvasTexture(canvas), {
      isColor: true,
      mipmaps: true,
      anisotropy: 4,
    });

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: new THREE.Color("#FFFFFF"),
      emissiveMap: texture,
      emissiveIntensity: 0.34,
      roughness: 0.16,
      metalness: 0.08,
    });

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x * 0.91, size.y * 0.85),
      mat,
    );
    plane.position.set(center.x, center.y + size.y * 0.02, box.max.z + 0.004);
    plane.name = "lounge-tv-screen";
    plane.userData.noBatch = true;
    tvWrapper.add(plane);

    this.loungeScreen = {
      mesh: plane,
      material: mat,
      canvas,
      ctx,
      texture,
      activeViewers: 0,
      lastRenderKey: null,
    };

    this._redrawLoungeTV();
  }

  setAgentScreenState(agentId, { mode, taskLabel, taskFile, partnerName } = {}) {
    for (const entry of this.stationScreens.values()) {
      if (entry.agentConfig?.id === agentId) {
        if (mode) entry.mode = mode;
        if (taskLabel !== undefined) entry.taskLabel = taskLabel;
        if (taskFile !== undefined) entry.taskFile = taskFile;
        if (partnerName !== undefined) entry.partnerName = partnerName;
        entry.dirty = true;
        this._redrawStation(entry);
      }
    }
  }

  updateAgentProfile(agentId, profile) {
    if (!profile) return;
    for (const entry of this.stationScreens.values()) {
      if (entry.agentConfig?.id === agentId) {
        entry.agentConfig = { ...entry.agentConfig, ...profile };
        entry.dirty = true;
        this._redrawStation(entry);
      }
    }
    if (this.meetingScreen) {
      this._redrawMeetingTV();
    }
    if (this.whiteboardScreen) {
      this._redrawMeetingWhiteboard();
    }
  }

  getWhiteboardNotes() {
    return this.whiteboardNotes.map((n) => ({ ...n }));
  }

  _normalizeWhiteboardNote(raw = {}) {
    const text = String(raw.text || raw.note || "").trim();
    if (!text) return null;
    const createdAt = Number(raw.createdAt) || Date.now();
    const id =
      String(raw.id || "").trim() ||
      `wb_${createdAt}_${text.slice(0, 16).replace(/\s+/g, "_")}`;
    return {
      id,
      agentId: raw.agentId || "architect",
      agentName: String(raw.agentName || raw.author || "Tech Lead"),
      color: raw.color || "#8B5CF6",
      text: text.slice(0, 220),
      createdAt,
    };
  }

  setWhiteboardNotes(notes = []) {
    const byId = new Map();
    for (const raw of Array.isArray(notes) ? notes : []) {
      const normalized = this._normalizeWhiteboardNote(raw);
      if (normalized && !byId.has(normalized.id)) {
        byId.set(normalized.id, normalized);
      }
    }
    this.whiteboardNotes = Array.from(byId.values())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 8);
    if (this.whiteboardScreen) {
      this._redrawMeetingWhiteboard();
    }
    return this.getWhiteboardNotes();
  }

  addWhiteboardNote(raw = {}) {
    const normalized = this._normalizeWhiteboardNote(raw);
    if (!normalized) return null;
    const filtered = this.whiteboardNotes.filter((n) => n.id !== normalized.id);
    this.whiteboardNotes = [normalized, ...filtered]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 8);
    if (this.whiteboardScreen) {
      this._redrawMeetingWhiteboard();
    }
    return normalized;
  }

  setMeetingState({ active = false, topic = null, presenterName = null } = {}) {
    if (!this.meetingScreen) return;
    this.meetingScreen.mode = active ? "MEETING" : "STANDBY";
    if (topic) this.meetingScreen.topic = topic;
    if (presenterName) this.meetingScreen.presenterName = presenterName;
    this._redrawMeetingTV();
    this._redrawMeetingWhiteboard();
  }

  syncFromAgentSnapshots(snapshots = {}) {
    for (const snap of Object.values(snapshots)) {
      const notSeatedAtOwnDesk =
        snap.isPhysicallyAtDesk === false ||
        snap.isTransitioningSeat === true ||
        snap.checkpointId !== AGENT_STATIONS[snap.id]?.checkpointId;

      let mode = "WORKING";
      let taskLabel = snap.taskTitle || snap.actionLabel;
      if (notSeatedAtOwnDesk) {
        mode = "AWAY";
        taskLabel = snap.actionLabel || "Fuera del escritorio";
      } else if (snap.animation === "sittingCheer") {
        mode = "SUCCESS";
      } else if (snap.animation === "sittingDisbelief") {
        mode = "ERROR";
      } else if (
        snap.socialMode === "DESK_REVIEW" &&
        snap.socialPhase === "ENGAGED"
      ) {
        mode = "REVIEWING";
      } else if (snap.state === "THINKING") {
        mode = "THINKING";
      }

      this.setAgentScreenState(snap.id, {
        mode,
        taskLabel,
        partnerName: snap.socialPartnerName || null,
      });
    }
    if (this.whiteboardScreen) {
      this._redrawMeetingWhiteboard();
    }
  }

  setDayNightFactor(factor) {
    if (Math.abs(factor - this.nightFactor) < 0.0005) return;
    this.nightFactor = factor;
    // Contraste suave en pantallas para Tarde/Noche sin saturación ni halo neón agresivo
    const activeGlow = THREE.MathUtils.lerp(0.26, 0.64, factor);
    const standbyGlow = THREE.MathUtils.lerp(0.1, 0.28, factor);

    for (const entry of this.stationScreens.values()) {
      const intensity = entry.mode === "AWAY" ? standbyGlow : activeGlow;
      for (const mat of entry.materials) {
        mat.emissiveIntensity = intensity;
      }
    }
    for (const mat of this.standbyMaterials) {
      mat.emissiveIntensity = standbyGlow;
    }
    if (this.meetingScreen) {
      this.meetingScreen.material.emissiveIntensity = THREE.MathUtils.lerp(
        0.24,
        0.58,
        factor,
      );
    }
    if (this.loungeScreen) {
      this.loungeScreen.material.emissiveIntensity = THREE.MathUtils.lerp(
        0.24,
        0.56,
        factor,
      );
    }
  }

  _redrawStation(entry) {
    const renderKey = `${entry.mode}|${entry.taskLabel || ""}|${entry.taskFile || ""}|${entry.partnerName || ""}|${entry.agentConfig?.name || ""}|${entry.agentConfig?.color || ""}`;
    if (renderKey === entry.lastRenderKey) {
      entry.dirty = false;
      return false;
    }
    entry.lastRenderKey = renderKey;
    this.tickCounter++;

    const { ctx, rightCtx, mode, agentConfig } = entry;
    ctx.setTransform(entry.canvas.width / 512, 0, 0, entry.canvas.height / 320, 0, 0);
    rightCtx.setTransform(
      entry.rightCanvas.width / 512,
      0,
      0,
      entry.rightCanvas.height / 320,
      0,
      0,
    );
    const accent = agentConfig?.color || "#38BDF8";
    const snippet = ROLE_SNIPPETS[agentConfig?.id] || ROLE_SNIPPETS.frontend;
    const pulseStep = this.tickCounter % 6;

    // === MONITOR IZQUIERDO (Código / Diff / Estado Principal en estética nórdica limpia) ===
    ctx.fillStyle = "#111824";
    ctx.fillRect(0, 0, 512, 320);

    // Barra superior IDE minimalista
    ctx.fillStyle = "#1A2333";
    ctx.fillRect(0, 0, 512, 36);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 5, 320);

    // Puntos de ventana sobrios
    ["#64748B", "#64748B", "#64748B"].forEach((dotCol, i) => {
      ctx.fillStyle = dotCol;
      ctx.beginPath();
      ctx.arc(22 + i * 14, 18, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#E5E7EB";
    ctx.font = "600 14px monospace";
    ctx.fillText(entry.taskFile || snippet.file, 68, 23);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "12px sans-serif";
    ctx.fillText(agentConfig?.name || "Agent", 402, 23);

    if (mode === "AWAY") {
      ctx.fillStyle = "#162030";
      ctx.fillRect(46, 74, 420, 174);
      ctx.strokeStyle = "#2A374C";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(46, 74, 420, 174);

      const nowStr = new Date().toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
      ctx.fillStyle = "#F1F5F9";
      ctx.font = "600 50px monospace";
      ctx.fillText(nowStr, 178, 152);
      ctx.fillStyle = "#94A3B8";
      ctx.font = "16px sans-serif";
      ctx.fillText(entry.taskLabel || "Fuera del escritorio", 148, 198);
    } else if (mode === "REVIEWING") {
      ctx.fillStyle = "rgba(56, 189, 248, 0.10)";
      ctx.fillRect(18, 48, 476, 34);
      ctx.fillStyle = "#7DD3FC";
      ctx.font = "600 15px monospace";
      ctx.fillText(
        `PAIR REVIEW · ${entry.partnerName || "Compañero"}`,
        28,
        70,
      );

      const diffLines = [
        { sign: " ", text: "async function syncAgentRoutes() {", color: "#CBD5E1" },
        { sign: "-", text: "  const path = legacyWalk(pos);", color: "#FCA5A5", bg: "rgba(239,68,68,0.12)" },
        { sign: "+", text: "  const path = Pathfinding.findPath(pos);", color: "#86EFAC", bg: "rgba(34,197,94,0.12)" },
        { sign: "+", text: "  bus.emit('agent:state', { ok: true });", color: "#86EFAC", bg: "rgba(34,197,94,0.12)" },
        { sign: " ", text: "  return checkpointMgr.commit(path);", color: "#CBD5E1" },
        { sign: " ", text: "}", color: "#CBD5E1" },
      ];
      diffLines.forEach((line, idx) => {
        const y = 102 + idx * 32;
        if (line.bg) {
          ctx.fillStyle = line.bg;
          ctx.fillRect(18, y - 19, 476, 26);
        }
        ctx.fillStyle = line.color;
        ctx.font = "14px monospace";
        ctx.fillText(`${line.sign} ${line.text}`, 26, y);
      });
    } else if (mode === "SUCCESS") {
      ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
      ctx.fillRect(26, 62, 460, 210);
      ctx.strokeStyle = "#34D399";
      ctx.lineWidth = 2;
      ctx.strokeRect(26, 62, 460, 210);

      ctx.fillStyle = "#6EE7B7";
      ctx.font = "600 26px monospace";
      ctx.fillText("BUILD & TESTS PASSED", 78, 134);
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "17px sans-serif";
      ctx.fillText(entry.taskLabel || "Objetivo completado", 78, 180);
      ctx.fillStyle = "#A7F3D0";
      ctx.font = "14px monospace";
      ctx.fillText("✓ 0 errores · checkpoints verificados", 78, 224);
    } else if (mode === "ERROR") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fillRect(26, 62, 460, 210);
      ctx.strokeStyle = "#F87171";
      ctx.lineWidth = 2;
      ctx.strokeRect(26, 62, 460, 210);

      ctx.fillStyle = "#FCA5A5";
      ctx.font = "600 24px monospace";
      ctx.fillText("CHECK REQUIRES REVIEW", 74, 132);
      ctx.fillStyle = "#FECACA";
      ctx.font = "15px monospace";
      ctx.fillText("ERR_ASSERTION: revisar contrato bus", 66, 178);
      ctx.fillStyle = "#FDBA74";
      ctx.font = "15px sans-serif";
      ctx.fillText(entry.taskLabel || "Analizando incidente...", 66, 220);
    } else if (mode === "THINKING") {
      ctx.fillStyle = "rgba(125, 211, 252, 0.10)";
      ctx.fillRect(22, 52, 468, 38);
      ctx.strokeStyle = "rgba(125, 211, 252, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(22, 52, 468, 38);

      ctx.fillStyle = "#BAE6FD";
      ctx.font = "600 15px monospace";
      ctx.fillText("RAZONAMIENTO EN CURSO", 36, 76);

      // Barras limpias de inferencia
      for (let i = 0; i < 16; i++) {
        const waveH = 16 + Math.round(Math.abs(Math.sin(i * 0.55 + this.tickCounter * 0.85)) * 52);
        ctx.fillStyle = i % 2 === 0 ? "rgba(125, 211, 252, 0.58)" : "rgba(186, 230, 253, 0.35)";
        ctx.fillRect(30 + i * 28, 196 - waveH, 16, waveH);
      }

      ctx.fillStyle = "#162030";
      ctx.fillRect(22, 216, 468, 74);
      ctx.strokeStyle = "#243247";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(22, 216, 468, 74);

      const thoughtText = String(entry.taskLabel || "Pensando...").slice(0, 42);
      ctx.fillStyle = "#F1F5F9";
      ctx.font = "600 15px sans-serif";
      ctx.fillText(thoughtText, 36, 250);
      ctx.fillStyle = "#94A3B8";
      ctx.font = "12px monospace";
      ctx.fillText("Planificando pasos y contexto técnico", 36, 274);
    } else {
      // WORKING
      snippet.lines.forEach((line, idx) => {
        const y = 74 + idx * 36;
        if (idx === pulseStep) {
          ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
          ctx.fillRect(16, y - 22, 480, 29);
        }
        ctx.fillStyle = "#64748B";
        ctx.font = "13px monospace";
        ctx.fillText(String(idx + 1).padStart(2, "0"), 22, y);

        ctx.fillStyle = idx % 2 === 0 ? "#E5E7EB" : "#93C5FD";
        ctx.font = "14px monospace";
        ctx.fillText(line, 52, y);
      });

      if (this.tickCounter % 2 === 0) {
        ctx.fillStyle = accent;
        ctx.fillRect(52, 74 + pulseStep * 36 + 5, 10, 3);
      }
    }

    // === MONITOR DERECHO (Telemetría / Terminal / Métricas limpias) ===
    rightCtx.fillStyle = "#0F1622";
    rightCtx.fillRect(0, 0, 512, 320);
    rightCtx.fillStyle = "#172131";
    rightCtx.fillRect(0, 0, 512, 36);
    rightCtx.fillStyle = accent;
    rightCtx.fillRect(0, 0, 5, 320);

    rightCtx.fillStyle = "#CBD5E1";
    rightCtx.font = "600 14px monospace";
    rightCtx.fillText(snippet.metricTitle, 20, 23);

    if (mode === "AWAY") {
      rightCtx.fillStyle = "#475569";
      rightCtx.font = "17px monospace";
      rightCtx.fillText("SESIÓN EN PAUSA", 164, 165);
    } else {
      const barColor =
        mode === "ERROR"
          ? "#F87171"
          : mode === "SUCCESS"
            ? "#34D399"
            : mode === "THINKING"
              ? "#7DD3FC"
              : accent;
      for (let i = 0; i < 12; i++) {
        const val = 26 + ((i * 23 + this.tickCounter * 17) % 82);
        rightCtx.fillStyle = "#192334";
        rightCtx.fillRect(24 + i * 38, 60, 24, 108);
        rightCtx.fillStyle = barColor;
        rightCtx.fillRect(24 + i * 38, 168 - val, 24, val);
      }

      rightCtx.fillStyle = "#151F2E";
      rightCtx.fillRect(20, 190, 472, 104);
      rightCtx.strokeStyle = "#243247";
      rightCtx.strokeRect(20, 190, 472, 104);

      rightCtx.fillStyle = "#F1F5F9";
      rightCtx.font = "600 15px monospace";
      rightCtx.fillText(`> ${String(entry.taskLabel || "En progreso").slice(0, 36)}`, 34, 222);

      rightCtx.fillStyle = "#94A3B8";
      rightCtx.font = "13px monospace";
      rightCtx.fillText(snippet.metricSub, 34, 252);
      rightCtx.fillStyle = barColor;
      rightCtx.fillText(`STATUS: ${mode}`, 34, 278);
    }

    entry.texture.needsUpdate = true;
    entry.rightTexture.needsUpdate = true;
    entry.dirty = false;
    return true;
  }

  _redrawMeetingTV() {
    if (!this.meetingScreen) return false;
    const { ctx, texture, mode, topic, presenterName, canvas } = this.meetingScreen;

    let profileSig = "";
    for (const entry of this.stationScreens.values()) {
      if (entry.agentConfig) {
        profileSig += `${entry.agentConfig.id}:${entry.agentConfig.name}:${entry.agentConfig.color};`;
      }
    }
    const renderKey = `${mode}|${topic}|${presenterName}|${profileSig}`;
    if (renderKey === this.meetingScreen.lastRenderKey) {
      return false;
    }
    this.meetingScreen.lastRenderKey = renderKey;

    ctx.setTransform(canvas.width / 1024, 0, 0, canvas.height / 576, 0, 0);

    ctx.fillStyle = "#101826";
    ctx.fillRect(0, 0, 1024, 576);

    ctx.fillStyle = "#172234";
    ctx.fillRect(0, 0, 1024, 68);
    ctx.fillStyle = "#B68A56";
    ctx.fillRect(0, 0, 1024, 4);

    ctx.fillStyle = "#F3EFE8";
    ctx.font = "600 25px sans-serif";
    ctx.fillText(
      mode === "MEETING" ? "SALA DE REUNIONES · SINCRONIZACIÓN" : "ARQUITECTURA DE ESTUDIO · SPRINT",
      36,
      44,
    );

    ctx.fillStyle = mode === "MEETING" ? "#FBBF24" : "#94A3B8";
    ctx.font = "600 18px monospace";
    ctx.fillText(mode === "MEETING" ? "LIVE SYNC" : "STANDBY", 884, 44);

    // Panel izquierdo: Diagrama de arquitectura limpio y nodos conectados
    ctx.fillStyle = "#152032";
    ctx.fillRect(36, 98, 560, 434);
    ctx.strokeStyle = "#26354C";
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 98, 560, 434);

    if (mode === "MEETING") {
      ctx.fillStyle = "#FBBF24";
      ctx.font = "600 19px monospace";
      ctx.fillText(`PRESENTADOR: ${presenterName.toUpperCase()}`, 62, 144);

      ctx.fillStyle = "#F8FAFC";
      ctx.font = "600 26px sans-serif";
      const safeTopic =
        String(topic || "Sincronización").length > 34
          ? `${String(topic).slice(0, 33)}…`
          : String(topic || "Sincronización");
      ctx.fillText(safeTopic, 62, 188);
    } else {
      ctx.fillStyle = "#93C5FD";
      ctx.font = "600 18px monospace";
      ctx.fillText("TOPOLOGÍA MULTI-AGENTE", 62, 144);

      ctx.fillStyle = "#E2E8F0";
      ctx.font = "600 22px sans-serif";
      ctx.fillText("Flujo Coordinado · OpenCode Bridge", 62, 182);
    }

    // Diagrama vectorial limpio de arquitectura (Tech Lead -> Bus -> Workers)
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(316, 266);
    ctx.lineTo(316, 316);
    ctx.moveTo(156, 316);
    ctx.lineTo(476, 316);
    ctx.moveTo(156, 316);
    ctx.lineTo(156, 354);
    ctx.moveTo(316, 316);
    ctx.lineTo(316, 354);
    ctx.moveTo(476, 316);
    ctx.lineTo(476, 354);
    ctx.stroke();

    const drawNode = (x, y, w, h, label, sub, accentCol) => {
      ctx.fillStyle = "#1E293B";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = accentCol;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#F1F5F9";
      ctx.font = "600 15px sans-serif";
      ctx.fillText(label, x + 14, y + 26);
      ctx.fillStyle = "#94A3B8";
      ctx.font = "12px monospace";
      ctx.fillText(sub, x + 14, y + 46);
    };

    drawNode(206, 212, 220, 56, "Tech Lead", "Planner & Barrier", "#A78BFA");
    drawNode(76, 354, 152, 60, "Frontend", "UI & WebGL", "#EAB308");
    drawNode(240, 354, 152, 60, "Backend", "API & Events", "#38BDF8");
    drawNode(404, 354, 152, 60, "QA / Sys", "Tests & CLI", "#FB923C");

    ctx.fillStyle = "#94A3B8";
    ctx.font = "15px monospace";
    ctx.fillText(
      mode === "MEETING"
        ? "Barrera de encuentro sincronizada · 4 fases activas"
        : "Listo para delegación y sincronización de sprint",
      62,
      482,
    );

    // Panel derecho: estado limpio de agentes
    ctx.fillStyle = "#141E30";
    ctx.fillRect(624, 98, 364, 434);
    ctx.strokeStyle = "#243247";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(624, 98, 364, 434);

    ctx.fillStyle = "#CBD5E1";
    ctx.font = "600 18px monospace";
    ctx.fillText("ESTADO DEL EQUIPO", 652, 142);

    const defaultRoles = [
      { id: "architect", name: "Tech Lead", color: "#8B5CF6", pct: 0.92 },
      { id: "frontend", name: "Frontend", color: "#EAB308", pct: 0.85 },
      { id: "qa", name: "DevOps / QA", color: "#9333EA", pct: 0.88 },
      { id: "backend", name: "Backend", color: "#0284C7", pct: 0.78 },
      { id: "systems", name: "Systems", color: "#EA580C", pct: 0.81 },
    ];
    const roles = defaultRoles.map((r) => {
      for (const entry of this.stationScreens.values()) {
        if (entry.agentConfig?.id === r.id) {
          return {
            ...r,
            name: entry.agentConfig.name,
            color: entry.agentConfig.color,
          };
        }
      }
      return r;
    });
    roles.forEach((r, i) => {
      const y = 188 + i * 64;
      ctx.fillStyle = "#E5E7EB";
      ctx.font = "500 18px sans-serif";
      ctx.fillText(r.name, 652, y);
      ctx.fillStyle = "#1E293B";
      ctx.fillRect(652, y + 12, 304, 12);
      ctx.fillStyle = r.color;
      ctx.fillRect(652, y + 12, Math.round(304 * r.pct), 12);
    });

    texture.needsUpdate = true;
    return true;
  }

  _wrapCanvasLines(ctx, rawText, maxWidth, maxLines = 3) {
    const words = String(rawText || "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines = [];
    let current = "";
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i];
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) {
          lines.push(current);
          current = word;
        } else {
          lines.push(word.slice(0, 28));
          current = "";
        }
        if (lines.length === maxLines) {
          const last = lines[maxLines - 1];
          lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -1)}…` : last;
          return lines;
        }
      }
    }
    if (current && lines.length < maxLines) {
      lines.push(current);
    }
    return lines;
  }

  _redrawMeetingWhiteboard() {
    if (!this.whiteboardScreen) return false;
    const { ctx, texture, canvas } = this.whiteboardScreen;

    const notesSig = this.whiteboardNotes
      .map((n) => `${n.id}:${n.createdAt}:${n.text}`)
      .join(";");
    let stateSig = `${this.meetingScreen?.mode || "STANDBY"}#${notesSig}`;
    const activeCards = [];
    for (const entry of this.stationScreens.values()) {
      if (entry.agentConfig) {
        stateSig += `|${entry.agentConfig.id}:${entry.mode}:${entry.taskLabel || ""}`;
        activeCards.push({
          name: entry.agentConfig.name,
          color: entry.agentConfig.color || "#3B82F6",
          mode: entry.mode,
          label: entry.taskLabel || "En curso",
        });
      }
    }

    if (stateSig === this.whiteboardScreen.lastRenderKey) {
      return false;
    }
    this.whiteboardScreen.lastRenderKey = stateSig;

    ctx.setTransform(canvas.width / 1024, 0, 0, canvas.height / 512, 0, 0);

    // Tablero acrílico mate limpio
    ctx.fillStyle = "#F8F6F1";
    ctx.fillRect(0, 0, 1024, 512);

    ctx.fillStyle = "#EAE4DA";
    ctx.fillRect(0, 0, 1024, 60);
    ctx.fillStyle = "#2E3540";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("PIZARRA DE ARQUITECTURA", 32, 39);

    ctx.fillStyle = "#6B7280";
    ctx.font = "bold 15px monospace";
    const rightBadge =
      this.whiteboardNotes.length > 0
        ? `${this.whiteboardNotes.length} NOTAS RECIENTES`
        : this.meetingScreen?.mode === "MEETING"
          ? "SYNC EN VIVO"
          : "FLUJO ACTIVO";
    ctx.fillText(rightBadge, 818, 37);

    if (this.whiteboardNotes.length > 0) {
      const visibleNotes = this.whiteboardNotes.slice(0, 6);
      const colW = 468;
      const rowH = 122;

      visibleNotes.forEach((note, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const x = 32 + col * 492;
        const y = 78 + row * 134;

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(x, y, colW, rowH);
        ctx.strokeStyle = "#DCD6CC";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, colW, rowH);

        ctx.fillStyle = note.color || "#8B5CF6";
        ctx.fillRect(x, y, 8, rowH);

        const timeLabel = new Date(note.createdAt || Date.now()).toLocaleTimeString(
          "es-ES",
          { hour: "2-digit", minute: "2-digit" },
        );

        ctx.fillStyle = "#1F2937";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText(String(note.agentName || "Equipo").slice(0, 22), x + 20, y + 26);

        ctx.fillStyle = "#6B7280";
        ctx.font = "13px monospace";
        ctx.fillText(timeLabel, x + colW - 58, y + 25);

        ctx.fillStyle = "#374151";
        ctx.font = "15px sans-serif";
        const lines = this._wrapCanvasLines(ctx, note.text, colW - 36, 3);
        lines.forEach((line, lIdx) => {
          ctx.fillText(line, x + 20, y + 54 + lIdx * 22);
        });
      });

      // Pie limpio de contexto del equipo
      ctx.fillStyle = "#EFECE6";
      ctx.fillRect(32, 480, 960, 22);
      ctx.fillStyle = "#4B5563";
      ctx.font = "13px sans-serif";
      const summary = activeCards
        .slice(0, 5)
        .map((c) => `${c.name}: ${String(c.label).slice(0, 18)}`)
        .join("   ·   ");
      ctx.fillText(
        summary || "Notas sincronizadas con OpenCode MCP",
        44,
        496,
      );

      texture.needsUpdate = true;
      return true;
    }

    const cols = [
      { title: "BACKLOG", color: "#64748B" },
      { title: "EN CURSO", color: "#2563EB" },
      { title: "REVISIÓN", color: "#D97706" },
      { title: "HECHO", color: "#059669" },
    ];

    const colW = 224;
    cols.forEach((c, idx) => {
      const x = 30 + idx * 244;
      ctx.fillStyle = "#EFECE6";
      ctx.fillRect(x, 76, colW, 408);
      ctx.fillStyle = c.color;
      ctx.fillRect(x, 76, colW, 6);
      ctx.fillStyle = "#1F2937";
      ctx.font = "bold 16px monospace";
      ctx.fillText(c.title, x + 14, 106);
    });

    const buckets = [[], [], [], []];
    activeCards.forEach((card, i) => {
      if (card.mode === "SUCCESS") buckets[3].push(card);
      else if (card.mode === "REVIEWING" || card.mode === "ERROR") buckets[2].push(card);
      else if (card.mode === "WORKING" || card.mode === "THINKING") buckets[1].push(card);
      else buckets[i % 2 === 0 ? 0 : 1].push(card);
    });

    if (buckets[0].length === 0) {
      buckets[0].push({ name: "Arquitectura", color: "#8B5CF6", label: "PBR & Iluminación" });
    }
    if (buckets[3].length === 0) {
      buckets[3].push({ name: "Core 3D", color: "#059669", label: "Render 60 FPS" });
    }

    buckets.forEach((cards, colIdx) => {
      const colX = 42 + colIdx * 244;
      cards.slice(0, 3).forEach((card, cardIdx) => {
        const y = 126 + cardIdx * 104;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(colX, y, 200, 88);
        ctx.strokeStyle = "#DCD6CC";
        ctx.lineWidth = 2;
        ctx.strokeRect(colX, y, 200, 88);

        ctx.fillStyle = card.color;
        ctx.fillRect(colX, y, 8, 88);

        ctx.fillStyle = "#111827";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(String(card.name).slice(0, 18), colX + 18, y + 30);

        ctx.fillStyle = "#4B5563";
        ctx.font = "13px sans-serif";
        ctx.fillText(String(card.label).slice(0, 22), colX + 18, y + 58);
      });
    });

    texture.needsUpdate = true;
    return true;
  }

  _redrawLoungeTV() {
    if (!this.loungeScreen) return false;
    const renderKey = `${this.loungeScreen.activeViewers}`;
    if (renderKey === this.loungeScreen.lastRenderKey) {
      return false;
    }
    this.loungeScreen.lastRenderKey = renderKey;

    const { ctx, texture, canvas } = this.loungeScreen;
    ctx.setTransform(canvas.width / 768, 0, 0, canvas.height / 432, 0, 0);

    const grad = ctx.createLinearGradient(0, 0, 768, 432);
    grad.addColorStop(0, "#151E2E");
    grad.addColorStop(1, "#1F293D");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 768, 432);

    // Visualizador nórdico suave en tonos ámbar/salvia/pizarra
    for (let i = 0; i < 24; i++) {
      const h = 34 + Math.abs(Math.sin(i * 0.45 + 0.6)) * 130;
      ctx.fillStyle =
        i % 3 === 0
          ? "rgba(251, 191, 36, 0.48)"
          : i % 3 === 1
            ? "rgba(125, 211, 252, 0.44)"
            : "rgba(110, 231, 183, 0.40)";
      ctx.fillRect(64 + i * 27, 290 - h, 15, h);
    }

    ctx.fillStyle = "#F1EFE8";
    ctx.font = "600 23px sans-serif";
    ctx.fillText("LOUNGE STUDIO · AMBIENT VISUALIZER", 64, 72);
    ctx.fillStyle = "#94A3B8";
    ctx.font = "15px monospace";
    ctx.fillText("LO-FI TELEMETRY STREAM · PAUSA ACTIVA", 64, 102);

    texture.needsUpdate = true;
    return true;
  }

  update() {
    // Las texturas dinámicas se actualizan bajo demanda (dirty-flagging por cambio de estado o evento)
  }

  dispose() {
    for (const entry of this.stationScreens.values()) {
      entry.texture?.dispose();
      entry.rightTexture?.dispose();
      entry.materials.forEach((m) => m.dispose());
    }
    this.stationScreens.clear();

    this.standbyTexture?.dispose();
    this.standbyMaterials.forEach((m) => m.dispose());
    this.standbyMaterials = [];

    if (this.meetingScreen) {
      this.meetingScreen.texture?.dispose();
      this.meetingScreen.material?.dispose();
    }
    if (this.whiteboardScreen) {
      this.whiteboardScreen.texture?.dispose();
      this.whiteboardScreen.material?.dispose();
    }
    if (this.loungeScreen) {
      this.loungeScreen.texture?.dispose();
      this.loungeScreen.material?.dispose();
    }
  }
}
