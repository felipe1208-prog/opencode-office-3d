import * as THREE from "three";
import { AGENT_STATIONS } from "../../config/officeLayout.js";

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
    metricSub: "60 FPS · sRGB · DPR 1.5",
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
    metricSub: "Adapter ready · Mock fallback ON",
  },
};

export class MonitorScreenSystem {
  constructor() {
    this.stationScreens = new Map(); // stationKey -> { agentConfig, mode, taskLabel, taskFile, canvas, ctx, texture, materials: [], dirty, clockTimer }
    this.standbyTexture = null;
    this.standbyMaterials = [];
    this.meetingScreen = null;
    this.loungeScreen = null;
    this.nightFactor = 0.0;
    this.tickCounter = 0;
  }

  _getStandbyTexture() {
    if (this.standbyTexture) return this.standbyTexture;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");

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

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.standbyTexture = tex;
    return tex;
  }

  _ensureStationEntry(stationKey) {
    if (this.stationScreens.has(stationKey)) {
      return this.stationScreens.get(stationKey);
    }

    const agentConfig = CHECKPOINT_TO_AGENT[stationKey] || null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const rightCanvas = document.createElement("canvas");
    rightCanvas.width = 512;
    rightCanvas.height = 320;
    const rightCtx = rightCanvas.getContext("2d");

    const rightTexture = new THREE.CanvasTexture(rightCanvas);
    rightTexture.colorSpace = THREE.SRGBColorSpace;
    rightTexture.anisotropy = 4;

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
      redrawTimer: Math.random() * 0.8,
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
    let tex;
    let entry = null;

    if (isAssigned) {
      entry = this._ensureStationEntry(stationKey);
      tex = screenIndex === 0 ? entry.texture : entry.rightTexture;
    } else {
      tex = this._getStandbyTexture();
    }

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color("#FFFFFF"),
      emissiveMap: tex,
      emissiveIntensity: isAssigned ? 0.3 : 0.14,
      roughness: 0.16,
      metalness: 0.08,
    });

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

    monitorWrapper.add(plane);

    if (entry) {
      entry.materials.push(mat);
    } else {
      this.standbyMaterials.push(mat);
    }

    return plane;
  }

  registerMeetingTV(screenMesh) {
    if (!screenMesh) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 576;
    const ctx = canvas.getContext("2d");

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: new THREE.Color("#FFFFFF"),
      emissiveMap: texture,
      emissiveIntensity: 0.32,
      roughness: 0.14,
      metalness: 0.1,
    });

    screenMesh.material = mat;
    this.meetingScreen = {
      mesh: screenMesh,
      material: mat,
      canvas,
      ctx,
      texture,
      mode: "STANDBY", // STANDBY | MEETING
      topic: "Sprint Sync · Oficina Virtual 3D",
      presenterName: "Tech Lead",
      redrawTimer: 0,
    };

    this._redrawMeetingTV();
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
    canvas.width = 768;
    canvas.height = 432;
    const ctx = canvas.getContext("2d");

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

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
    tvWrapper.add(plane);

    this.loungeScreen = {
      mesh: plane,
      material: mat,
      canvas,
      ctx,
      texture,
      activeViewers: 0,
      redrawTimer: 0,
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
  }

  setMeetingState({ active = false, topic = null, presenterName = null } = {}) {
    if (!this.meetingScreen) return;
    this.meetingScreen.mode = active ? "MEETING" : "STANDBY";
    if (topic) this.meetingScreen.topic = topic;
    if (presenterName) this.meetingScreen.presenterName = presenterName;
    this._redrawMeetingTV();
  }

  syncFromAgentSnapshots(snapshots = {}) {
    for (const snap of Object.values(snapshots)) {
      let mode = "WORKING";
      if (snap.animation === "sittingCheer") mode = "SUCCESS";
      else if (snap.animation === "sittingDisbelief") mode = "ERROR";
      else if (snap.socialMode === "DESK_REVIEW") mode = "REVIEWING";
      else if (snap.checkpointId !== AGENT_STATIONS[snap.id]?.checkpointId) {
        mode = "AWAY";
      } else if (snap.state === "THINKING") {
        mode = "THINKING";
      }

      this.setAgentScreenState(snap.id, {
        mode,
        taskLabel: snap.taskTitle || snap.actionLabel,
        partnerName: snap.socialPartnerName || null,
      });
    }
  }

  setDayNightFactor(factor) {
    this.nightFactor = factor;
    const activeGlow = THREE.MathUtils.lerp(0.28, 0.96, factor);
    const standbyGlow = THREE.MathUtils.lerp(0.12, 0.36, factor);

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
        0.28,
        0.85,
        factor,
      );
    }
    if (this.loungeScreen) {
      this.loungeScreen.material.emissiveIntensity = THREE.MathUtils.lerp(
        0.28,
        0.82,
        factor,
      );
    }
  }

  _redrawStation(entry) {
    const { ctx, rightCtx, mode, agentConfig } = entry;
    const accent = agentConfig?.color || "#38BDF8";
    const snippet = ROLE_SNIPPETS[agentConfig?.id] || ROLE_SNIPPETS.frontend;
    const pulseStep = this.tickCounter % 6;

    // === MONITOR IZQUIERDO (Código / Diff / Estado Principal) ===
    ctx.fillStyle = "#0B1120";
    ctx.fillRect(0, 0, 512, 320);

    // Barra superior IDE
    ctx.fillStyle = "#162033";
    ctx.fillRect(0, 0, 512, 34);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 6, 320);

    ctx.fillStyle = "#E2E8F0";
    ctx.font = "bold 15px monospace";
    ctx.fillText(entry.taskFile || snippet.file, 18, 22);

    ctx.fillStyle = "#94A3B8";
    ctx.font = "13px monospace";
    ctx.fillText(agentConfig?.name || "Agent", 390, 22);

    if (mode === "AWAY") {
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(42, 72, 428, 176);
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 2;
      ctx.strokeRect(42, 72, 428, 176);

      const nowStr = new Date().toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "bold 52px monospace";
      ctx.fillText(nowStr, 175, 152);
      ctx.fillStyle = "#64748B";
      ctx.font = "17px sans-serif";
      ctx.fillText(entry.taskLabel || "Fuera del escritorio", 145, 200);
    } else if (mode === "REVIEWING") {
      ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
      ctx.fillRect(16, 46, 480, 34);
      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 16px monospace";
      ctx.fillText(
        `PAIR REVIEW · ${entry.partnerName || "Compañero"}`,
        26,
        69,
      );

      const diffLines = [
        { sign: " ", text: "async function syncAgentRoutes() {", color: "#CBD5E1" },
        { sign: "-", text: "  const path = legacyWalk(pos);", color: "#FCA5A5", bg: "rgba(239,68,68,0.16)" },
        { sign: "+", text: "  const path = Pathfinding.findPath(pos);", color: "#86EFAC", bg: "rgba(34,197,94,0.16)" },
        { sign: "+", text: "  bus.emit('agent:state', { ok: true });", color: "#86EFAC", bg: "rgba(34,197,94,0.16)" },
        { sign: " ", text: "  return checkpointMgr.commit(path);", color: "#CBD5E1" },
        { sign: " ", text: "}", color: "#CBD5E1" },
      ];
      diffLines.forEach((line, idx) => {
        const y = 96 + idx * 33;
        if (line.bg) {
          ctx.fillStyle = line.bg;
          ctx.fillRect(16, y - 20, 480, 28);
        }
        ctx.fillStyle = line.color;
        ctx.font = "15px monospace";
        ctx.fillText(`${line.sign} ${line.text}`, 24, y);
      });
    } else if (mode === "SUCCESS") {
      ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
      ctx.fillRect(24, 62, 464, 210);
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 3;
      ctx.strokeRect(24, 62, 464, 210);

      ctx.fillStyle = "#34D399";
      ctx.font = "bold 28px monospace";
      ctx.fillText("BUILD & TESTS PASSED", 76, 134);
      ctx.fillStyle = "#E2E8F0";
      ctx.font = "18px sans-serif";
      ctx.fillText(entry.taskLabel || "Objetivo completado", 76, 180);
      ctx.fillStyle = "#6EE7B7";
      ctx.font = "15px monospace";
      ctx.fillText("✓ 0 errores · 47 checkpoints verificados", 76, 224);
    } else if (mode === "ERROR") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.16)";
      ctx.fillRect(24, 62, 464, 210);
      ctx.strokeStyle = "#EF4444";
      ctx.lineWidth = 3;
      ctx.strokeRect(24, 62, 464, 210);

      ctx.fillStyle = "#F87171";
      ctx.font = "bold 26px monospace";
      ctx.fillText("CHECK REQUIRES REVIEW", 74, 132);
      ctx.fillStyle = "#FECACA";
      ctx.font = "16px monospace";
      ctx.fillText("ERR_ASSERTION: revisar contrato bus", 64, 178);
      ctx.fillStyle = "#FDBA74";
      ctx.font = "15px sans-serif";
      ctx.fillText(entry.taskLabel || "Analizando incidente...", 64, 220);
    } else if (mode === "THINKING") {
      ctx.fillStyle = "rgba(14, 165, 233, 0.14)";
      ctx.fillRect(20, 52, 472, 40);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(20, 52, 472, 40);

      ctx.fillStyle = "#7DD3FC";
      ctx.font = "bold 17px monospace";
      ctx.fillText("RAZONAMIENTO COGNITIVO EN CURSO", 34, 78);

      // Ondas de inferencia animadas en el monitor izquierdo
      for (let i = 0; i < 16; i++) {
        const waveH = 18 + Math.round(Math.abs(Math.sin(i * 0.55 + this.tickCounter * 0.85)) * 56);
        ctx.fillStyle = i % 2 === 0 ? "rgba(56, 189, 248, 0.72)" : "rgba(125, 211, 252, 0.45)";
        ctx.fillRect(28 + i * 28, 198 - waveH, 18, waveH);
      }

      ctx.fillStyle = "#0F172A";
      ctx.fillRect(20, 218, 472, 74);
      ctx.strokeStyle = "#1E293B";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(20, 218, 472, 74);

      const thoughtText = String(entry.taskLabel || "Pensando...").slice(0, 42);
      ctx.fillStyle = "#E0F2FE";
      ctx.font = "bold 16px sans-serif";
      ctx.fillText(thoughtText, 34, 252);
      ctx.fillStyle = "#94A3B8";
      ctx.font = "13px monospace";
      ctx.fillText("Analizando contexto antes de ejecutar herramienta", 34, 278);
    } else {
      // WORKING
      snippet.lines.forEach((line, idx) => {
        const y = 72 + idx * 36;
        if (idx === pulseStep) {
          ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
          ctx.fillRect(14, y - 22, 484, 30);
        }
        ctx.fillStyle = "#475569";
        ctx.font = "14px monospace";
        ctx.fillText(String(idx + 1).padStart(2, "0"), 20, y);

        ctx.fillStyle = idx % 2 === 0 ? "#E2E8F0" : "#7DD3FC";
        ctx.font = "15px monospace";
        ctx.fillText(line, 52, y);
      });

      // Cursor parpadeante
      if (this.tickCounter % 2 === 0) {
        ctx.fillStyle = accent;
        ctx.fillRect(52, 72 + pulseStep * 36 + 5, 10, 3);
      }
    }

    // === MONITOR DERECHO (Telemetría / Terminal / Métricas) ===
    rightCtx.fillStyle = "#080D18";
    rightCtx.fillRect(0, 0, 512, 320);
    rightCtx.fillStyle = "#131C2E";
    rightCtx.fillRect(0, 0, 512, 34);
    rightCtx.fillStyle = accent;
    rightCtx.fillRect(0, 0, 6, 320);

    rightCtx.fillStyle = "#94A3B8";
    rightCtx.font = "bold 15px monospace";
    rightCtx.fillText(snippet.metricTitle, 18, 22);

    if (mode === "AWAY") {
      rightCtx.fillStyle = "#334155";
      rightCtx.font = "18px monospace";
      rightCtx.fillText("SESIÓN EN PAUSA", 162, 165);
    } else {
      // Gráfico de barras de actividad / build
      const barColor =
        mode === "ERROR"
          ? "#EF4444"
          : mode === "SUCCESS"
            ? "#10B981"
            : mode === "THINKING"
              ? "#38BDF8"
              : accent;
      for (let i = 0; i < 12; i++) {
        const val = 28 + ((i * 23 + this.tickCounter * 17) % 86);
        rightCtx.fillStyle = "rgba(30, 41, 59, 0.9)";
        rightCtx.fillRect(24 + i * 38, 60, 26, 110);
        rightCtx.fillStyle = barColor;
        rightCtx.fillRect(24 + i * 38, 170 - val, 26, val);
      }

      rightCtx.fillStyle = "#111A2B";
      rightCtx.fillRect(20, 192, 472, 104);
      rightCtx.strokeStyle = "#1E293B";
      rightCtx.strokeRect(20, 192, 472, 104);

      rightCtx.fillStyle = "#E2E8F0";
      rightCtx.font = "bold 16px monospace";
      rightCtx.fillText(`> ${String(entry.taskLabel || "En progreso").slice(0, 36)}`, 34, 224);

      rightCtx.fillStyle = "#94A3B8";
      rightCtx.font = "14px monospace";
      rightCtx.fillText(snippet.metricSub, 34, 254);
      rightCtx.fillStyle = barColor;
      rightCtx.fillText(`STATUS: ${mode}`, 34, 280);
    }

    entry.texture.needsUpdate = true;
    entry.rightTexture.needsUpdate = true;
    entry.dirty = false;
  }

  _redrawMeetingTV() {
    if (!this.meetingScreen) return;
    const { ctx, texture, mode, topic, presenterName } = this.meetingScreen;

    ctx.fillStyle = "#0B1220";
    ctx.fillRect(0, 0, 1024, 576);

    ctx.fillStyle = "#142038";
    ctx.fillRect(0, 0, 1024, 68);
    ctx.fillStyle = "#38BDF8";
    ctx.fillRect(0, 0, 1024, 5);

    ctx.fillStyle = "#F8FAFC";
    ctx.font = "bold 26px sans-serif";
    ctx.fillText(
      mode === "MEETING" ? "REUNIÓN DE EQUIPO EN CURSO" : "OFICINA VIRTUAL · SALA DE REUNIONES",
      36,
      44,
    );

    ctx.fillStyle = "#94A3B8";
    ctx.font = "20px monospace";
    ctx.fillText(
      new Date().toLocaleTimeString("es-ES", { hour12: false }),
      880,
      44,
    );

    if (mode === "MEETING") {
      ctx.fillStyle = "#16243F";
      ctx.fillRect(36, 100, 560, 420);
      ctx.strokeStyle = "#38BDF8";
      ctx.lineWidth = 2;
      ctx.strokeRect(36, 100, 560, 420);

      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 22px monospace";
      ctx.fillText(`PRESENTADOR: ${presenterName.toUpperCase()}`, 64, 148);

      ctx.fillStyle = "#F8FAFC";
      ctx.font = "bold 28px sans-serif";
      const safeTopic =
        String(topic || "Sincronización").length > 34
          ? `${String(topic).slice(0, 33)}…`
          : String(topic || "Sincronización");
      ctx.fillText(safeTopic, 64, 200);

      const bullets = [
        "1. Contrato de OfficeEventBus desacoplado",
        "2. Feedback diegético en monitores y burbujas",
        "3. Rutinas colaborativas: Pair Chat & Desk Review",
        "4. Iluminación nocturna ambiental por zonas",
      ];
      bullets.forEach((b, idx) => {
        ctx.fillStyle = "#CBD5E1";
        ctx.font = "22px sans-serif";
        ctx.fillText(b, 64, 266 + idx * 52);
      });

      // Panel derecho: diagrama sprint
      ctx.fillStyle = "#111B2E";
      ctx.fillRect(624, 100, 364, 420);
      ctx.fillStyle = "#A78BFA";
      ctx.font = "bold 20px monospace";
      ctx.fillText("ESTADO DE AGENTES", 652, 144);

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
        const y = 190 + i * 62;
        ctx.fillStyle = "#E2E8F0";
        ctx.font = "18px sans-serif";
        ctx.fillText(r.name, 652, y);
        ctx.fillStyle = "#1E293B";
        ctx.fillRect(652, y + 12, 300, 14);
        ctx.fillStyle = r.color;
        ctx.fillRect(652, y + 12, Math.round(300 * r.pct), 14);
      });
    } else {
      ctx.fillStyle = "#111A2E";
      ctx.fillRect(80, 140, 864, 320);
      ctx.strokeStyle = "#1E293B";
      ctx.lineWidth = 2;
      ctx.strokeRect(80, 140, 864, 320);

      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 36px sans-serif";
      ctx.fillText("SALA DISPONIBLE", 345, 275);
      ctx.fillStyle = "#94A3B8";
      ctx.font = "22px monospace";
      ctx.fillText(
        "Listo para sincronización de sprint · Pulsa 'Reunión'",
        205,
        332,
      );
    }

    texture.needsUpdate = true;
  }

  _redrawLoungeTV() {
    if (!this.loungeScreen) return;
    const { ctx, texture } = this.loungeScreen;

    const grad = ctx.createLinearGradient(0, 0, 768, 432);
    grad.addColorStop(0, "#0F172A");
    grad.addColorStop(1, "#1E1B4B");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 768, 432);

    // Visualizador ambiental suave
    for (let i = 0; i < 24; i++) {
      const h = 36 + Math.abs(Math.sin(i * 0.45 + this.tickCounter * 0.6)) * 140;
      ctx.fillStyle = i % 2 === 0 ? "rgba(56, 189, 248, 0.55)" : "rgba(167, 139, 250, 0.55)";
      ctx.fillRect(64 + i * 27, 290 - h, 16, h);
    }

    ctx.fillStyle = "#E2E8F0";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("LOUNGE STUDIO · AMBIENT VISUALIZER", 64, 72);
    ctx.fillStyle = "#94A3B8";
    ctx.font = "16px monospace";
    ctx.fillText("LO-FI TELEMETRY STREAM · PAUSA ACTIVA", 64, 102);

    texture.needsUpdate = true;
  }

  update(delta) {
    let ticked = false;
    for (const entry of this.stationScreens.values()) {
      entry.redrawTimer += delta;
      if (entry.redrawTimer >= 0.9) {
        entry.redrawTimer = 0;
        if (!ticked) {
          this.tickCounter++;
          ticked = true;
        }
        this._redrawStation(entry);
      }
    }

    if (this.loungeScreen) {
      this.loungeScreen.redrawTimer += delta;
      if (this.loungeScreen.redrawTimer >= 0.8) {
        this.loungeScreen.redrawTimer = 0;
        this._redrawLoungeTV();
      }
    }

    if (this.meetingScreen && this.meetingScreen.mode === "MEETING") {
      this.meetingScreen.redrawTimer += delta;
      if (this.meetingScreen.redrawTimer >= 1.0) {
        this.meetingScreen.redrawTimer = 0;
        this._redrawMeetingTV();
      }
    }
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
    if (this.loungeScreen) {
      this.loungeScreen.texture?.dispose();
      this.loungeScreen.material?.dispose();
    }
  }
}
