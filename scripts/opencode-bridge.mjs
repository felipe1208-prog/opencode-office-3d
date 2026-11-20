#!/usr/bin/env node
/**
 * Puente Local sin dependencias para conectar OpenCode Server (:4096)
 * con la Oficina Virtual 3D, resolviendo CORS, Basic Auth y eventos webhook locales.
 *
 * Uso:
 *   npm run opencode:bridge
 * Variables opcionales:
 *   BRIDGE_PORT=4097
 *   OPENCODE_URL=http://127.0.0.1:4096
 *   OPENCODE_SERVER_USERNAME=opencode
 *   OPENCODE_SERVER_PASSWORD=tu_clave
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4097);
const BRIDGE_HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const OPENCODE_URL = (process.env.OPENCODE_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");

const AUTH_USER = process.env.OPENCODE_SERVER_USERNAME || "";
const AUTH_PASS = process.env.OPENCODE_SERVER_PASSWORD || "";

const sseClients = new Set();

let detectedUpstreamPrefix = "/api";

const MAX_WHITEBOARD_NOTES = 18;
const MAX_SPATIAL_COMMANDS = 100;
const MAX_DIFF_BYTES = 65536;
const MAX_PEER_REVIEW_ROUNDS = 2;
const PEER_REVIEW_CHAIN_TTL_MS = 45 * 60 * 1000;
const BRIDGE_DATA_DIR = path.join(os.homedir(), ".opencode-office-3d");
const BRIDGE_CONFIG_PATH = path.join(BRIDGE_DATA_DIR, "config.json");

const AGENT_META = {
  architect: {
    id: "architect",
    name: "Tech Lead",
    color: "#8B5CF6",
    zoneId: "supervisor",
    zoneName: "Oficina del Tech Lead",
    locationLabel: "Escritorio del Tech Lead",
    position: { x: -8.4, z: -6.5 },
    checkpointId: "supervisor-desk",
    nearbyObjects: [
      {
        id: "desk-architect",
        label: "Escritorio del Tech Lead",
        type: "workstation",
        distanceM: 0.9,
        state: "con monitor principal y portátil de coordinación",
      },
      {
        id: "supervisor-guest-chairs",
        label: "Sillas de visita de dirección",
        type: "seating",
        distanceM: 1.9,
        state: "disponibles frente al escritorio",
      },
    ],
  },
  frontend: {
    id: "frontend",
    name: "Frontend Dev",
    color: "#E09F5A",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de Frontend Dev",
    position: { x: -6.7, z: 4.18 },
    checkpointId: "dev-pod2-nw",
    nearbyObjects: [
      {
        id: "desk-frontend",
        label: "Escritorio de Frontend Dev",
        type: "workstation",
        distanceM: 0.6,
        state: "con monitores duales WebGL",
      },
      {
        id: "desk-qa",
        label: "Escritorio de DevOps / QA",
        type: "workstation",
        distanceM: 1.5,
        state: "con monitores de pruebas",
      },
      {
        id: "desk-systems",
        label: "Escritorio de Systems Dev",
        type: "workstation",
        distanceM: 1.4,
        state: "con terminal CLI y automatización",
      },
    ],
  },
  qa: {
    id: "qa",
    name: "DevOps / QA",
    color: "#22C55E",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de DevOps / QA",
    position: { x: -5.3, z: 4.18 },
    checkpointId: "dev-pod2-ne",
    nearbyObjects: [
      {
        id: "desk-qa",
        label: "Escritorio de DevOps / QA",
        type: "workstation",
        distanceM: 0.6,
        state: "con monitores de pruebas",
      },
      {
        id: "desk-backend",
        label: "Escritorio de Backend Dev",
        type: "workstation",
        distanceM: 1.4,
        state: "con monitores de API y datos",
      },
      {
        id: "desk-frontend",
        label: "Escritorio de Frontend Dev",
        type: "workstation",
        distanceM: 1.5,
        state: "con monitores duales WebGL",
      },
    ],
  },
  backend: {
    id: "backend",
    name: "Backend Dev",
    color: "#06B6D4",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de Backend Dev",
    position: { x: -5.3, z: 6.22 },
    checkpointId: "dev-pod2-se",
    nearbyObjects: [
      {
        id: "desk-backend",
        label: "Escritorio de Backend Dev",
        type: "workstation",
        distanceM: 0.6,
        state: "con monitores de API y datos",
      },
      {
        id: "desk-systems",
        label: "Escritorio de Systems Dev",
        type: "workstation",
        distanceM: 1.5,
        state: "con terminal CLI y automatización",
      },
      {
        id: "desk-qa",
        label: "Escritorio de DevOps / QA",
        type: "workstation",
        distanceM: 1.4,
        state: "con monitores de pruebas",
      },
    ],
  },
  systems: {
    id: "systems",
    name: "Systems Dev",
    color: "#EC4899",
    zoneId: "dev-area",
    zoneName: "Área de Desarrollo",
    locationLabel: "Escritorio de Systems Dev",
    position: { x: -6.7, z: 6.22 },
    checkpointId: "dev-pod2-sw",
    nearbyObjects: [
      {
        id: "desk-systems",
        label: "Escritorio de Systems Dev",
        type: "workstation",
        distanceM: 0.6,
        state: "con terminal CLI y automatización",
      },
      {
        id: "desk-backend",
        label: "Escritorio de Backend Dev",
        type: "workstation",
        distanceM: 1.5,
        state: "con monitores de API y datos",
      },
      {
        id: "desk-frontend",
        label: "Escritorio de Frontend Dev",
        type: "workstation",
        distanceM: 1.4,
        state: "con monitores duales WebGL",
      },
    ],
  },
};

const AGENT_ALIAS_TO_ID = {
  architect: "architect",
  "tech-lead": "architect",
  techlead: "architect",
  lead: "architect",
  lider: "architect",
  jefe: "architect",
  supervisor: "architect",
  orchestrator: "architect",
  main: "architect",
  frontend: "frontend",
  "frontend-dev": "frontend",
  ui: "frontend",
  ux: "frontend",
  webgl: "frontend",
  threejs: "frontend",
  qa: "qa",
  devops: "qa",
  "devops-qa": "qa",
  reviewer: "qa",
  "code-reviewer": "qa",
  test: "qa",
  audit: "qa",
  backend: "backend",
  "backend-dev": "backend",
  api: "backend",
  server: "backend",
  servidor: "backend",
  db: "backend",
  systems: "systems",
  "systems-dev": "systems",
  cli: "systems",
  sistemas: "systems",
  automation: "systems",
  infra: "systems",
};

function resolveAgentId(rawAgent) {
  const norm = String(rawAgent || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@+/, "")
    .replace(/[\s_]+/g, "-");
  return AGENT_ALIAS_TO_ID[norm] || null;
}

function buildSeedSpatialState() {
  const now = Date.now();
  const agents = {};
  const entries = Object.values(AGENT_META);

  for (const meta of entries) {
    const nearbyPeers = entries
      .filter((other) => other.id !== meta.id && other.zoneId === meta.zoneId)
      .map((other) => ({
        id: other.id,
        name: other.name,
        distanceM: Number(
          Math.hypot(other.position.x - meta.position.x, other.position.z - meta.position.z).toFixed(1),
        ),
        sameZone: true,
        zoneName: other.zoneName,
        activity: "en su escritorio",
      }))
      .sort((a, b) => a.distanceM - b.distanceM);

    agents[meta.id] = {
      id: meta.id,
      name: meta.name,
      color: meta.color,
      zoneId: meta.zoneId,
      zoneName: meta.zoneName,
      locationLabel: meta.locationLabel,
      position: { ...meta.position },
      posture: "sentado",
      state: "WORKING",
      actionLabel: "En su escritorio",
      taskTitle: null,
      checkpointId: meta.checkpointId,
      isMoving: false,
      targetLocation: null,
      nearbyObjects: meta.nearbyObjects.map((o) => ({ ...o })),
      nearbyPeers,
      whiteboardNear: false,
      updatedAt: now,
    };
  }

  return {
    updatedAt: now,
    source: "bridge-seed",
    agents,
    whiteboard: {
      notes: [],
      updatedAt: null,
    },
  };
}

const spatialState = buildSeedSpatialState();
let spatialCommandQueue = [];
let spatialCommandSeq = 0;
let deletedWhiteboardIds = new Set();
let recentPeerReviews = [];
const peerReviewChains = new Map();
const preferredAgentSessions = {};
let lastClientAuthHeader = "";

function ensureBridgeDataDir() {
  try {
    fs.mkdirSync(BRIDGE_DATA_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function readJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJsonFileSafe(filePath, payload) {
  if (!ensureBridgeDataDir()) return false;
  try {
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }
}

function isValidExistingDir(candidate) {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    const resolved = path.resolve(candidate.trim());
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function loadInitialProjectDir() {
  const fromEnv = process.env.OFFICE_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR;
  if (isValidExistingDir(fromEnv)) return path.resolve(fromEnv);
  const cfg = readJsonFileSafe(BRIDGE_CONFIG_PATH);
  if (isValidExistingDir(cfg?.projectDir)) return path.resolve(cfg.projectDir);
  return path.resolve(process.cwd());
}

let activeProjectDir = loadInitialProjectDir();

function getWhiteboardFilePath(projectDir = activeProjectDir) {
  const norm = path.resolve(projectDir || process.cwd());
  const hash = crypto.createHash("sha1").update(norm).digest("hex").slice(0, 12);
  return path.join(BRIDGE_DATA_DIR, `whiteboard-${hash}.json`);
}

function loadPersistedWhiteboard(projectDir = activeProjectDir) {
  const saved = readJsonFileSafe(getWhiteboardFilePath(projectDir));
  deletedWhiteboardIds = new Set(Array.isArray(saved?.deletedIds) ? saved.deletedIds.slice(-100) : []);
  const notes = Array.isArray(saved?.notes)
    ? saved.notes
        .filter((n) => n && typeof n === "object" && String(n.text || "").trim() && !deletedWhiteboardIds.has(n.id))
        .slice(0, MAX_WHITEBOARD_NOTES)
    : [];
  spatialState.whiteboard.notes = notes;
  spatialState.whiteboard.updatedAt = notes[0]?.createdAt || saved?.updatedAt || null;
}

function savePersistedWhiteboard() {
  writeJsonFileSafe(getWhiteboardFilePath(activeProjectDir), {
    projectDir: activeProjectDir,
    updatedAt: spatialState.whiteboard.updatedAt || Date.now(),
    notes: spatialState.whiteboard.notes,
    deletedIds: Array.from(deletedWhiteboardIds).slice(-100),
  });
}

function saveBridgeConfig() {
  writeJsonFileSafe(BRIDGE_CONFIG_PATH, {
    projectDir: activeProjectDir,
    updatedAt: Date.now(),
  });
}

loadPersistedWhiteboard(activeProjectDir);

function mergeWhiteboardNotes(existing = [], incoming = []) {
  const byId = new Map();
  for (const item of [...incoming, ...existing]) {
    if (!item || typeof item !== "object") continue;
    const text = String(item.text || item.note || "").trim();
    if (!text) continue;
    const id = String(item.id || `wb_${item.createdAt || Date.now()}`).trim();
    if (deletedWhiteboardIds.has(id)) continue;
    if (!byId.has(id)) {
      const isHuman = item.authorType === "human" || item.agentId === "user";
      byId.set(id, {
        id,
        agentId: isHuman ? "user" : (item.agentId || "architect"),
        agentName: isHuman
          ? (item.agentName || "Tech Lead (Tú)")
          : (item.agentName || AGENT_META[item.agentId]?.name || item.agentId || "Tech Lead"),
        authorType: isHuman ? "human" : "agent",
        color: isHuman ? "#D97706" : (item.color || AGENT_META[item.agentId]?.color || "#8B5CF6"),
        text: text.slice(0, 240),
        createdAt: Number(item.createdAt) || Date.now(),
      });
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_WHITEBOARD_NOTES);
}

function resolveSafeWorkspacePath(relPath) {
  if (!relPath || typeof relPath !== "string") return null;
  const cleaned = relPath.trim().replace(/^["']|["']$/g, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const root = path.resolve(activeProjectDir);
  const full = path.resolve(root, cleaned);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return { root, full, relative: path.relative(root, full).split(path.sep).join("/") };
}

async function runGitSafe(args = []) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: activeProjectDir,
    timeout: 4500,
    maxBuffer: 1024 * 768,
    windowsHide: true,
  });
  return String(stdout || "");
}

function describeGitStatusCode(xy) {
  if (xy === "??") return "Nuevo";
  if (xy.includes("D")) return "Eliminado";
  if (xy.includes("R")) return "Renombrado";
  if (xy.includes("A")) return "Agregado";
  if (xy.includes("U")) return "Conflicto";
  return "Modificado";
}

async function getWorkspaceSummary() {
  const projectName = path.basename(activeProjectDir) || activeProjectDir;
  const base = {
    ok: true,
    projectDir: activeProjectDir,
    projectName,
    storageDir: BRIDGE_DATA_DIR,
    isGitRepo: false,
    branch: null,
    ahead: 0,
    behind: 0,
    changes: [],
    updatedAt: Date.now(),
  };

  try {
    const inside = (await runGitSafe(["rev-parse", "--is-inside-work-tree"])).trim();
    if (inside !== "true") return base;
    base.isGitRepo = true;

    const statusOut = await runGitSafe(["status", "--porcelain=v1", "-b", "--untracked-files=all"]);
    const lines = statusOut.split(/\r?\n/).filter(Boolean);
    const changesMap = new Map();

    for (const line of lines) {
      if (line.startsWith("## ")) {
        const header = line.slice(3).trim();
        const branchPart = header.split("...")[0].replace(/^No commits yet on\s+/i, "").trim();
        base.branch = branchPart || "HEAD";
        const aheadMatch = header.match(/ahead (\d+)/);
        const behindMatch = header.match(/behind (\d+)/);
        if (aheadMatch) base.ahead = Number(aheadMatch[1]);
        if (behindMatch) base.behind = Number(behindMatch[1]);
        continue;
      }

      if (line.length < 4) continue;
      const xy = line.slice(0, 2);
      let filePath = line.slice(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ").pop().trim();
      }
      filePath = filePath.replace(/^"|"$/g, "");
      if (!filePath) continue;

      const normalizedStatus =
        xy === "??"
          ? "untracked"
          : xy.includes("D")
            ? "deleted"
            : xy.includes("R")
              ? "renamed"
              : xy.includes("A")
                ? "added"
                : "modified";

      changesMap.set(filePath, {
        path: filePath,
        code: xy.trim() || "M",
        status: normalizedStatus,
        statusLabel: describeGitStatusCode(xy),
        staged: xy[0] !== " " && xy[0] !== "?",
        unstaged: xy[1] !== " ",
        isUntracked: xy === "??",
        insertions: 0,
        deletions: 0,
      });
    }

    const parseNumstat = (raw) => {
      for (const l of raw.split(/\r?\n/)) {
        const parts = l.split("\t");
        if (parts.length < 3) continue;
        const ins = parts[0] === "-" ? 0 : Number(parts[0]) || 0;
        const del = parts[1] === "-" ? 0 : Number(parts[1]) || 0;
        const p = parts.slice(2).join("\t").trim();
        const item = changesMap.get(p);
        if (item) {
          item.insertions += ins;
          item.deletions += del;
        }
      }
    };

    try {
      parseNumstat(await runGitSafe(["diff", "--numstat"]));
      parseNumstat(await runGitSafe(["diff", "--cached", "--numstat"]));
    } catch {
      // Repositorio sin HEAD inicial o diff parcial
    }

    base.changes = Array.from(changesMap.values()).slice(0, 120);
    return base;
  } catch {
    return base;
  }
}

async function getWorkspaceDiff(relPath) {
  const safe = resolveSafeWorkspacePath(relPath);
  if (!safe) {
    return { ok: false, error: "Ruta fuera del proyecto activo o inválida." };
  }

  let diffText = "";
  let isUntracked = false;

  try {
    const statusLine = (await runGitSafe(["status", "--porcelain=v1", "--", safe.relative])).trim();
    isUntracked = statusLine.startsWith("??");

    if (isUntracked) {
      if (fs.existsSync(safe.full) && fs.statSync(safe.full).isFile()) {
        const stat = fs.statSync(safe.full);
        if (stat.size > 512 * 1024) {
          diffText = `+++ ${safe.relative}\n@@ Archivo nuevo (${Math.round(stat.size / 1024)} KB, vista previa omitida por tamaño) @@`;
        } else {
          const buf = fs.readFileSync(safe.full);
          if (buf.includes(0)) {
            diffText = `+++ ${safe.relative}\n@@ Archivo binario nuevo (${stat.size} bytes) @@`;
          } else {
            const rawLines = buf.toString("utf8").split(/\r?\n/);
            const shown = rawLines.slice(0, 220);
            diffText =
              `--- /dev/null\n+++ b/${safe.relative}\n@@ -0,0 +1,${shown.length} @@\n` +
              shown.map((l) => `+${l}`).join("\n");
            if (rawLines.length > 220) {
              diffText += `\n... (+${rawLines.length - 220} líneas adicionales)`;
            }
          }
        }
      }
    } else {
      try {
        diffText = await runGitSafe(["diff", "HEAD", "--", safe.relative]);
      } catch {
        const unstaged = await runGitSafe(["diff", "--", safe.relative]).catch(() => "");
        const staged = await runGitSafe(["diff", "--cached", "--", safe.relative]).catch(() => "");
        diffText = [staged, unstaged].filter(Boolean).join("\n");
      }
    }
  } catch (err) {
    return { ok: false, error: err?.message || "No se pudo calcular el diff de Git." };
  }

  let truncated = false;
  if (Buffer.byteLength(diffText, "utf8") > MAX_DIFF_BYTES) {
    diffText = `${diffText.slice(0, MAX_DIFF_BYTES)}\n... [diff truncado a 64 KB]`;
    truncated = true;
  }

  return {
    ok: true,
    path: safe.relative,
    diff: diffText,
    isUntracked,
    truncated,
  };
}

async function getWorkspaceLog(limit = 15) {
  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 15));
  try {
    const inside = (await runGitSafe(["rev-parse", "--is-inside-work-tree"]).catch(() => "")).trim();
    if (inside !== "true") {
      return { ok: true, isGitRepo: false, commits: [] };
    }
    const raw = await runGitSafe([
      "log",
      `-n`,
      String(safeLimit),
      "--date=iso-strict",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s",
    ]).catch(() => "");

    const commits = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, author, date, ...subjectParts] = line.split("\x1f");
        return {
          hash: String(hash || "").trim(),
          shortHash: String(shortHash || "").trim(),
          author: String(author || "").trim(),
          date: String(date || "").trim(),
          subject: subjectParts.join(" ").trim(),
        };
      })
      .filter((c) => c.hash);

    return { ok: true, isGitRepo: true, commits };
  } catch (err) {
    return {
      ok: false,
      isGitRepo: false,
      commits: [],
      error: err?.message || "No se pudo consultar el historial de commits.",
    };
  }
}

async function getWorkspaceCommitDetail(rawHash) {
  const hash = String(rawHash || "").trim();
  if (!/^[0-9a-f]{6,40}$/i.test(hash)) {
    return { ok: false, error: "Identificador de commit inválido." };
  }
  try {
    let diffText = await runGitSafe(["show", "--stat", "--patch", "--max-count=1", hash]);
    let truncated = false;
    if (Buffer.byteLength(diffText, "utf8") > MAX_DIFF_BYTES) {
      diffText = `${diffText.slice(0, MAX_DIFF_BYTES)}\n... [commit truncado a 64 KB]`;
      truncated = true;
    }
    return { ok: true, hash, diff: diffText, truncated };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "No se pudo inspeccionar el commit solicitado.",
    };
  }
}

function getWorkspaceFileSnippet(relPath, maxLines = 48) {
  const safe = resolveSafeWorkspacePath(relPath);
  if (!safe) {
    return { ok: false, error: "Ruta inválida o fuera del workspace." };
  }
  try {
    if (!fs.existsSync(safe.full) || !fs.statSync(safe.full).isFile()) {
      return { ok: false, error: "Archivo no encontrado." };
    }
    const stat = fs.statSync(safe.full);
    if (stat.size > 512 * 1024) {
      return { ok: false, error: "Archivo demasiado grande para vista previa." };
    }
    const buf = fs.readFileSync(safe.full);
    if (buf.includes(0)) {
      return { ok: false, error: "Archivo binario." };
    }
    const allLines = buf.toString("utf8").split(/\r?\n/);
    const limit = Math.max(8, Math.min(120, Number(maxLines) || 48));
    return {
      ok: true,
      path: safe.relative,
      lines: allLines.slice(0, limit),
      totalLines: allLines.length,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Error leyendo archivo." };
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Cache-Control");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function buildUpstreamHeaders(reqHeaders = {}) {
  const headers = { ...reqHeaders };
  delete headers.host;
  delete headers.connection;
  delete headers["content-length"];
  delete headers.origin;
  delete headers.referer;

  if (headers.authorization) {
    lastClientAuthHeader = headers.authorization;
  } else if (AUTH_USER || AUTH_PASS) {
    const token = Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64");
    headers.authorization = `Basic ${token}`;
  } else if (lastClientAuthHeader) {
    headers.authorization = lastClientAuthHeader;
  }
  return headers;
}

function pruneExpiredPeerReviewChains(now = Date.now()) {
  for (const [key, chain] of peerReviewChains.entries()) {
    if (!chain || now - (chain.updatedAt || chain.createdAt || 0) > PEER_REVIEW_CHAIN_TTL_MS) {
      peerReviewChains.delete(key);
    }
  }
}

function normalizeChainSlug(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function findOrCreatePeerReviewChain({ fromAgentId, toAgentId, files = [], threadKey = "" } = {}) {
  const now = Date.now();
  pruneExpiredPeerReviewChains(now);

  const explicitSlug = normalizeChainSlug(threadKey);
  if (explicitSlug) {
    const key = `thread:${explicitSlug}`;
    let existing = peerReviewChains.get(key);
    if (!existing) {
      existing = {
        key,
        rounds: 0,
        maxRounds: MAX_PEER_REVIEW_ROUNDS,
        participants: new Set([fromAgentId, toAgentId]),
        files: new Set(files),
        history: [],
        escalated: false,
        blockedAttempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      peerReviewChains.set(key, existing);
    }
    existing.participants.add(fromAgentId);
    existing.participants.add(toAgentId);
    for (const f of files) existing.files.add(f);
    return existing;
  }

  // Buscar cadena activa que comparta archivos o el mismo par de especialistas en los últimos 30 min
  const recentWindowMs = 30 * 60 * 1000;
  let matched = null;
  for (const chain of peerReviewChains.values()) {
    if (now - chain.updatedAt > recentWindowMs) continue;
    const sharesFile = files.length > 0 && files.some((f) => chain.files.has(f));
    const sharesPair = chain.participants.has(fromAgentId) && chain.participants.has(toAgentId);
    if (sharesFile || sharesPair) {
      if (!matched || chain.updatedAt > matched.updatedAt) {
        matched = chain;
      }
    }
  }

  if (matched) {
    matched.participants.add(fromAgentId);
    matched.participants.add(toAgentId);
    for (const f of files) matched.files.add(f);
    return matched;
  }

  const pair = [fromAgentId, toAgentId].sort().join("-");
  const key = `rev_${pair}_${now.toString(36)}`;
  const created = {
    key,
    rounds: 0,
    maxRounds: MAX_PEER_REVIEW_ROUNDS,
    participants: new Set([fromAgentId, toAgentId]),
    files: new Set(files),
    history: [],
    escalated: false,
    blockedAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  peerReviewChains.set(key, created);
  return created;
}

async function resolveReviewerSessionId(prefix, toAgentId, contextPreview = "") {
  const cached = preferredAgentSessions[toAgentId];
  if (cached && typeof cached === "string") {
    return cached;
  }

  const headers = buildUpstreamHeaders({ accept: "application/json" });
  try {
    const listResp = await fetch(`${OPENCODE_URL}${prefix}/session`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    });
    if (listResp.ok) {
      const payload = await listResp.json().catch(() => null);
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.sessions)
          ? payload.sessions
          : Array.isArray(payload?.data)
            ? payload.data
            : [];

      const matching = list
        .filter((s) => {
          const sAgent = resolveAgentId(s?.agent || s?.agentId || s?.profile);
          if (sAgent === toAgentId) return true;
          const title = String(s?.title || "").toLowerCase();
          return title.includes(`@${toAgentId}`) || title.includes(`[revisión ${toAgentId}]`);
        })
        .sort((a, b) => Number(b?.time?.updated || b?.updatedAt || 0) - Number(a?.time?.updated || a?.updatedAt || 0));

      if (matching[0]?.id) {
        preferredAgentSessions[toAgentId] = matching[0].id;
        return matching[0].id;
      }
    }
  } catch {
    // Continuar con creación de sesión dedicada
  }

  try {
    const createResp = await fetch(`${OPENCODE_URL}${prefix}/session`, {
      method: "POST",
      headers: buildUpstreamHeaders({
        accept: "application/json",
        "content-type": "application/json",
      }),
      body: JSON.stringify({
        title: `Revisión @${toAgentId}: ${String(contextPreview || "revisión").slice(0, 34)}`,
        agent: toAgentId,
      }),
      signal: AbortSignal.timeout(3500),
    });
    if (createResp.ok) {
      const created = await createResp.json().catch(() => null);
      const newId = created?.id || created?.session?.id || created?.data?.id || null;
      if (newId) {
        preferredAgentSessions[toAgentId] = newId;
        return newId;
      }
    }
  } catch {
    // Fallback controlado
  }
  return null;
}

async function dispatchPeerReviewToOpenCode({
  fromAgentId,
  fromAgentName,
  toAgentId,
  toAgentName,
  context,
  files = [],
  round = 1,
  maxRounds = MAX_PEER_REVIEW_ROUNDS,
  chainKey = "",
} = {}) {
  const probe = await probeUpstream();
  if (!probe.ok) {
    return {
      dispatched: false,
      targetSessionId: preferredAgentSessions[toAgentId] || null,
      error: probe.error || "OpenCode Server no disponible para despacho automático.",
    };
  }

  const prefix = probe.prefix ?? detectedUpstreamPrefix;
  const targetSessionId = await resolveReviewerSessionId(prefix, toAgentId, context);
  if (!targetSessionId) {
    return {
      dispatched: false,
      targetSessionId: null,
      error: `No se pudo resolver ni crear una sesión activa para @${toAgentId}.`,
    };
  }

  const filesSection =
    files.length > 0 ? `\nArchivos implicados:\n${files.map((f) => `- ${f}`).join("\n")}` : "";
  const remainingAfterThis = Math.max(0, maxRounds - round);
  const loopGuardNote =
    remainingAfterThis > 0
      ? `Esta es la ronda ${round}/${maxRounds} de revisión automática (hilo: ${chainKey}). Si necesitas devolver un ajuste concreto a @${fromAgentId}, pasa hilo="${chainKey}" en pedir_revision_a.`
      : `ATENCIÓN: Esta es la ronda final (${round}/${maxRounds}, hilo: ${chainKey}). Aplica tu revisión o resume claramente cualquier bloqueo para el Tech Lead humano; NO vuelvas a rebotar esta tarea con pedir_revision_a.`;

  const promptText = [
    `[Revisión automática entre especialistas · Ronda ${round}/${maxRounds}]`,
    `Solicitada por: ${fromAgentName} (@${fromAgentId}) -> Para: ${toAgentName} (@${toAgentId})`,
    filesSection,
    "",
    "Contexto a revisar:",
    context,
    "",
    loopGuardNote,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
    .trim();

  const headers = buildUpstreamHeaders({
    accept: "application/json",
    "content-type": "application/json",
  });

  const bodies = [
    { agent: toAgentId, parts: [{ type: "text", text: promptText }] },
    { agent: toAgentId, text: promptText },
  ];
  const endpoints = [
    `${OPENCODE_URL}${prefix}/session/${encodeURIComponent(targetSessionId)}/prompt_async`,
    `${OPENCODE_URL}${prefix}/session/${encodeURIComponent(targetSessionId)}/prompt`,
  ];

  let lastError = null;
  for (const url of endpoints) {
    const isAsync = url.endsWith("/prompt_async");
    for (const body of bodies) {
      try {
        const fetchPromise = fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(isAsync ? 4000 : 12000),
        });

        const race = isAsync
          ? { settled: true, resp: await fetchPromise }
          : await Promise.race([
              fetchPromise
                .then((resp) => ({ settled: true, resp }))
                .catch((err) => ({ settled: true, err })),
              new Promise((resolve) => setTimeout(() => resolve({ settled: false }), 1500)),
            ]);

        if (!race.settled) {
          // /prompt sigue ejecutándose en segundo plano en OpenCode
          fetchPromise.catch(() => {});
          return {
            dispatched: true,
            targetSessionId,
            dispatchEndpoint: "prompt",
            error: null,
          };
        }

        if (race.err) {
          lastError = race.err.message || "Error de red al despachar revisión.";
          continue;
        }

        if (race.resp.ok || race.resp.status === 204) {
          return {
            dispatched: true,
            targetSessionId,
            dispatchEndpoint: isAsync ? "prompt_async" : "prompt",
            error: null,
          };
        }

        lastError = `HTTP ${race.resp.status} al despachar revisión.`;
        if (race.resp.status === 404 || race.resp.status === 405) {
          break; // Probar siguiente endpoint
        }
      } catch (err) {
        lastError = err?.message || "Timeout al despachar revisión.";
      }
    }
  }

  return {
    dispatched: false,
    targetSessionId,
    error: lastError || "No se pudo despachar el turno al revisor en OpenCode.",
  };
}

function broadcastCustomEvent(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function probeSessionAt(pathPrefix) {
  const target = `${OPENCODE_URL}${pathPrefix}/session`;
  const resp = await fetch(target, {
    headers: buildUpstreamHeaders({ accept: "application/json" }),
    signal: AbortSignal.timeout(2500),
  });
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");
  const isHtml = contentType.includes("text/html");
  return { resp, isJson, isHtml };
}

async function probeUpstream() {
  try {
    const v2 = await probeSessionAt("/api");
    if (v2.resp.status === 401) {
      detectedUpstreamPrefix = "/api";
      return {
        ok: false,
        status: 401,
        prefix: "/api",
        error: "Autenticación requerida (Basic Auth)",
      };
    }
    if (v2.resp.ok && v2.isJson) {
      detectedUpstreamPrefix = "/api";
      return { ok: true, status: v2.resp.status, prefix: "/api", error: null };
    }

    if (v2.resp.status === 404 || v2.isHtml) {
      const legacy = await probeSessionAt("");
      if (legacy.resp.status === 401) {
        detectedUpstreamPrefix = "";
        return {
          ok: false,
          status: 401,
          prefix: "",
          error: "Autenticación requerida (Basic Auth)",
        };
      }
      if (legacy.resp.ok && legacy.isJson) {
        detectedUpstreamPrefix = "";
        return { ok: true, status: legacy.resp.status, prefix: "", error: null };
      }
      if (v2.isHtml || legacy.isHtml) {
        return {
          ok: false,
          status: v2.resp.status,
          prefix: detectedUpstreamPrefix,
          error: "OpenCode devolvió HTML (SPA fallback) en lugar de JSON (/api/session)",
        };
      }
    }

    return {
      ok: false,
      status: v2.resp.status,
      prefix: detectedUpstreamPrefix,
      error: `HTTP ${v2.resp.status} en /api/session`,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      prefix: detectedUpstreamPrefix,
      error: err?.message || "Upstream unavailable",
    };
  }
}

async function handleHealth(_req, res) {
  const probe = await probeUpstream();

  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(
    JSON.stringify({
      bridge: "ok",
      bridgeUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
      upstreamUrl: OPENCODE_URL,
      upstreamPrefix: probe.prefix,
      upstreamOk: probe.ok,
      upstreamStatus: probe.status,
      upstreamError: probe.error,
      clients: sseClients.size,
      spatialSource: spatialState.source,
      spatialUpdatedAt: spatialState.updatedAt,
      pendingSpatialCommands: spatialCommandQueue.length,
      projectDir: activeProjectDir,
      whiteboardNotesCount: spatialState.whiteboard.notes.length,
    }),
  );
}

async function proxyHttp(req, res, targetUrl) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const upstreamResp = await fetch(targetUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      signal: controller.signal,
    });

    const contentType = upstreamResp.headers.get("content-type") || "application/json";
    const isSse = contentType.includes("text/event-stream");
    res.writeHead(upstreamResp.status, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      ...(isSse ? { Connection: "keep-alive", "X-Accel-Buffering": "no" } : {}),
    });

    if (!upstreamResp.body) {
      res.end();
      return;
    }

    const reader = upstreamResp.body.getReader();
    if (isSse) {
      sseClients.add(res);
    }

    const heartbeat = isSse
      ? setInterval(() => {
          try {
            res.write(": keepalive\n\n");
          } catch {
            clearInterval(heartbeat);
          }
        }, 15000)
      : null;

    const decoder = isSse ? new TextDecoder() : null;
    let sseBuffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.writableEnded) continue;

        if (!isSse) {
          res.write(value);
          continue;
        }

        // Emitir frames SSE completos por delimitador \n\n para que broadcastCustomEvent
        // nunca se intercale a mitad de un frame JSON fragmentado entre chunks TCP.
        sseBuffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundaryIdx;
        while ((boundaryIdx = sseBuffer.indexOf("\n\n")) !== -1) {
          const completeFrame = sseBuffer.slice(0, boundaryIdx + 2);
          sseBuffer = sseBuffer.slice(boundaryIdx + 2);
          if (completeFrame) {
            res.write(completeFrame);
          }
        }
      }
      if (isSse && sseBuffer && !res.writableEnded) {
        res.write(sseBuffer.endsWith("\n\n") ? sseBuffer : `${sseBuffer}\n\n`);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (isSse) sseClients.delete(res);
      if (!res.writableEnded) res.end();
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    }
    if (!res.writableEnded) {
      res.end(
        JSON.stringify({
          error: "No se pudo conectar con opencode serve",
          targetUrl,
          detail: err?.message || "Upstream unavailable",
        }),
      );
    }
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const rawUrl = req.url || "/";
  const queryIdx = rawUrl.indexOf("?");
  const reqPath = queryIdx >= 0 ? rawUrl.slice(0, queryIdx) : rawUrl;
  const query = queryIdx >= 0 ? rawUrl.slice(queryIdx) : "";
  const searchParams = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);

  if (reqPath === "/bridge/health") {
    await handleHealth(req, res);
    return;
  }

  // Workspace Git y lectura segura (solo lectura, validada dentro de activeProjectDir)
  if (reqPath === "/api/office/workspace" || reqPath === "/office/workspace") {
    if (req.method === "GET") {
      const summary = await getWorkspaceSummary();
      sendJson(res, 200, summary);
      return;
    }
  }

  if (reqPath === "/api/office/workspace/dir" || reqPath === "/office/workspace/dir") {
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const rawDir = String(body?.dir || body?.projectDir || "").trim();
        if (!isValidExistingDir(rawDir)) {
          sendJson(res, 400, {
            ok: false,
            error: "La carpeta indicada no existe o no es accesible en este equipo.",
          });
          return;
        }
        activeProjectDir = path.resolve(rawDir);
        saveBridgeConfig();
        loadPersistedWhiteboard(activeProjectDir);

        const summary = await getWorkspaceSummary();
        broadcastCustomEvent({
          type: "office.workspace.updated",
          properties: { workspace: summary },
        });
        broadcastCustomEvent({
          type: "office.whiteboard.updated",
          properties: { whiteboard: spatialState.whiteboard, projectDir: activeProjectDir },
        });
        sendJson(res, 200, {
          ...summary,
          whiteboard: spatialState.whiteboard,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en workspace/dir" });
      }
      return;
    }
  }

  if (reqPath === "/api/office/workspace/diff" || reqPath === "/office/workspace/diff") {
    if (req.method === "GET") {
      const targetPath = searchParams.get("path") || "";
      const result = await getWorkspaceDiff(targetPath);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
  }

  if (reqPath === "/api/office/workspace/file" || reqPath === "/office/workspace/file") {
    if (req.method === "GET") {
      const targetPath = searchParams.get("path") || "";
      const maxLines = Number(searchParams.get("maxLines") || 48);
      const result = getWorkspaceFileSnippet(targetPath, maxLines);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
  }

  if (reqPath === "/api/office/workspace/log" || reqPath === "/office/workspace/log") {
    if (req.method === "GET") {
      const limit = Number(searchParams.get("limit") || 15);
      const result = await getWorkspaceLog(limit);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
  }

  if (reqPath === "/api/office/workspace/commit" || reqPath === "/office/workspace/commit") {
    if (req.method === "GET") {
      const hash = searchParams.get("hash") || "";
      const result = await getWorkspaceCommitDetail(hash);
      sendJson(res, result.ok ? 200 : 400, result);
      return;
    }
  }

  // Pizarra de Arquitectura bidireccional persistente fuera de git
  if (reqPath === "/api/office/whiteboard" || reqPath === "/office/whiteboard") {
    if (req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        projectDir: activeProjectDir,
        notes: spatialState.whiteboard.notes,
        updatedAt: spatialState.whiteboard.updatedAt,
      });
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const text = String(body?.text || body?.note || body?.nota || "").trim();
        if (!text) {
          sendJson(res, 400, { ok: false, error: "La nota no puede estar vacía." });
          return;
        }
        const now = Date.now();
        spatialCommandSeq += 1;
        const isHuman = body?.authorType === "human" || body?.agentId === "user" || !body?.agentId;
        const resolvedAgent = isHuman ? "user" : (resolveAgentId(body?.agentId) || "architect");
        const meta = !isHuman ? AGENT_META[resolvedAgent] : null;
        const noteRecord = {
          id: `wb_${now}_${spatialCommandSeq}`,
          agentId: resolvedAgent,
          agentName: isHuman
            ? String(body?.agentName || "Tech Lead (Tú)").trim().slice(0, 32)
            : (meta?.name || resolvedAgent),
          authorType: isHuman ? "human" : "agent",
          color: isHuman ? "#D97706" : (meta?.color || "#8B5CF6"),
          text: text.slice(0, 240),
          createdAt: now,
        };

        spatialState.whiteboard.notes = mergeWhiteboardNotes(
          spatialState.whiteboard.notes,
          [noteRecord],
        );
        spatialState.whiteboard.updatedAt = now;
        savePersistedWhiteboard();

        broadcastCustomEvent({
          type: "office.whiteboard.updated",
          properties: {
            whiteboard: spatialState.whiteboard,
            note: noteRecord,
            projectDir: activeProjectDir,
          },
        });

        sendJson(res, 200, {
          ok: true,
          note: noteRecord,
          notes: spatialState.whiteboard.notes,
          whiteboard: spatialState.whiteboard,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en whiteboard" });
      }
      return;
    }
  }

  if (reqPath === "/api/office/whiteboard/archive" || reqPath === "/office/whiteboard/archive") {
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const clearAll = Boolean(body?.clearAll);
        const noteId = String(body?.id || "").trim();

        if (clearAll) {
          for (const n of spatialState.whiteboard.notes) {
            if (n?.id) deletedWhiteboardIds.add(n.id);
          }
          spatialState.whiteboard.notes = [];
          spatialState.whiteboard.updatedAt = Date.now();
        } else if (noteId) {
          deletedWhiteboardIds.add(noteId);
          spatialState.whiteboard.notes = spatialState.whiteboard.notes.filter(
            (n) => n.id !== noteId,
          );
          spatialState.whiteboard.updatedAt = Date.now();
        }

        savePersistedWhiteboard();
        broadcastCustomEvent({
          type: "office.whiteboard.updated",
          properties: {
            whiteboard: spatialState.whiteboard,
            projectDir: activeProjectDir,
          },
        });

        sendJson(res, 200, {
          ok: true,
          notes: spatialState.whiteboard.notes,
          whiteboard: spatialState.whiteboard,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en whiteboard/archive" });
      }
      return;
    }
  }

  // Revisión entre pares autónoma con límite de seguridad (máx. 2 rondas por hilo/tarea)
  if (reqPath === "/api/office/peer-review/reset" || reqPath === "/office/peer-review/reset") {
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const rawKey = String(body?.chainKey || body?.hilo || "").trim();
        let cleared = 0;
        if (rawKey) {
          if (peerReviewChains.delete(rawKey)) cleared += 1;
          const prefixed = `thread:${normalizeChainSlug(rawKey)}`;
          if (peerReviewChains.delete(prefixed)) cleared += 1;
        } else {
          cleared = peerReviewChains.size;
          peerReviewChains.clear();
        }
        sendJson(res, 200, { ok: true, cleared });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en peer-review/reset" });
      }
      return;
    }
  }

  if (reqPath === "/api/office/peer-review" || reqPath === "/office/peer-review") {
    if (req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        maxRounds: MAX_PEER_REVIEW_ROUNDS,
        reviews: recentPeerReviews,
        activeChains: Array.from(peerReviewChains.values()).map((c) => ({
          key: c.key,
          rounds: c.rounds,
          maxRounds: c.maxRounds,
          escalated: c.escalated,
          participants: Array.from(c.participants),
          updatedAt: c.updatedAt,
        })),
      });
      return;
    }
    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const fromAgentId = resolveAgentId(body?.fromAgentId || body?.agente);
        const toAgentId = resolveAgentId(body?.toAgentId || body?.destinatario);
        const context = String(body?.context || body?.contexto || "").trim().slice(0, 600);
        const threadKey = String(body?.threadKey || body?.hilo || body?.taskKey || "").trim();
        const files = Array.isArray(body?.files || body?.archivos)
          ? (body.files || body.archivos).map((f) => String(f || "").trim()).filter(Boolean).slice(0, 10)
          : [];

        if (!fromAgentId || !toAgentId || fromAgentId === toAgentId || !context) {
          sendJson(res, 400, {
            ok: false,
            error: "Se requieren fromAgentId, toAgentId distintos y contexto para pedir revisión.",
          });
          return;
        }

        const now = Date.now();
        spatialCommandSeq += 1;
        const fromMeta = AGENT_META[fromAgentId];
        const toMeta = AGENT_META[toAgentId];
        const chain = findOrCreatePeerReviewChain({ fromAgentId, toAgentId, files, threadKey });
        chain.updatedAt = now;

        // Límite de seguridad de rebotes: máximo 2 rondas automáticas por tarea/hilo
        if (chain.rounds >= MAX_PEER_REVIEW_ROUNDS) {
          chain.escalated = true;
          chain.blockedAttempts = (chain.blockedAttempts || 0) + 1;

          const escalatedReview = {
            id: `pr_${now}_${spatialCommandSeq}`,
            fromAgentId,
            fromAgentName: fromMeta?.name || fromAgentId,
            toAgentId,
            toAgentName: toMeta?.name || toAgentId,
            context,
            files,
            chainKey: chain.key,
            round: chain.rounds,
            maxRounds: MAX_PEER_REVIEW_ROUNDS,
            dispatched: false,
            limitReached: true,
            escalated: true,
            targetSessionId: preferredAgentSessions[toAgentId] || null,
            createdAt: now,
          };
          recentPeerReviews.unshift(escalatedReview);
          if (recentPeerReviews.length > 30) recentPeerReviews.length = 30;

          const escalatedCommand = {
            id: `sc_${now}_${spatialCommandSeq}`,
            type: "peer_review",
            agentId: fromAgentId,
            agentName: fromMeta?.name || fromAgentId,
            targetAgentId: toAgentId,
            targetAgentName: toMeta?.name || toAgentId,
            context,
            files,
            chainKey: chain.key,
            round: chain.rounds,
            maxRounds: MAX_PEER_REVIEW_ROUNDS,
            limitReached: true,
            escalated: true,
            createdAt: now,
          };
          spatialCommandQueue.push(escalatedCommand);
          if (spatialCommandQueue.length > MAX_SPATIAL_COMMANDS) {
            spatialCommandQueue = spatialCommandQueue.slice(-MAX_SPATIAL_COMMANDS);
          }

          broadcastCustomEvent({
            type: "office.peer_review",
            properties: { review: escalatedReview, command: escalatedCommand },
          });
          broadcastCustomEvent({
            type: "office.spatial.command",
            properties: { command: escalatedCommand, whiteboard: spatialState.whiteboard },
          });

          sendJson(res, 200, {
            ok: true,
            dispatched: false,
            limitReached: true,
            escalated: true,
            round: chain.rounds,
            maxRounds: MAX_PEER_REVIEW_ROUNDS,
            chainKey: chain.key,
            review: escalatedReview,
            command: escalatedCommand,
            clients: sseClients.size,
          });
          return;
        }

        // Ronda automática permitida (1/2 o 2/2): despachar turno real a OpenCode
        chain.rounds += 1;
        const round = chain.rounds;
        const dispatchRes = await dispatchPeerReviewToOpenCode({
          fromAgentId,
          fromAgentName: fromMeta?.name || fromAgentId,
          toAgentId,
          toAgentName: toMeta?.name || toAgentId,
          context,
          files,
          round,
          maxRounds: MAX_PEER_REVIEW_ROUNDS,
          chainKey: chain.key,
        });

        const review = {
          id: `pr_${now}_${spatialCommandSeq}`,
          fromAgentId,
          fromAgentName: fromMeta?.name || fromAgentId,
          toAgentId,
          toAgentName: toMeta?.name || toAgentId,
          context,
          files,
          chainKey: chain.key,
          round,
          maxRounds: MAX_PEER_REVIEW_ROUNDS,
          dispatched: Boolean(dispatchRes.dispatched),
          dispatchError: dispatchRes.error || null,
          targetSessionId: dispatchRes.targetSessionId || null,
          limitReached: false,
          escalated: false,
          createdAt: now,
        };
        chain.history.push({
          id: review.id,
          fromAgentId,
          toAgentId,
          round,
          dispatched: review.dispatched,
          createdAt: now,
        });
        recentPeerReviews.unshift(review);
        if (recentPeerReviews.length > 30) recentPeerReviews.length = 30;

        const command = {
          id: `sc_${now}_${spatialCommandSeq}`,
          type: "peer_review",
          agentId: fromAgentId,
          agentName: fromMeta?.name || fromAgentId,
          targetAgentId: toAgentId,
          targetAgentName: toMeta?.name || toAgentId,
          context,
          files,
          chainKey: chain.key,
          round,
          maxRounds: MAX_PEER_REVIEW_ROUNDS,
          dispatched: review.dispatched,
          limitReached: false,
          escalated: false,
          createdAt: now,
        };
        spatialCommandQueue.push(command);
        if (spatialCommandQueue.length > MAX_SPATIAL_COMMANDS) {
          spatialCommandQueue = spatialCommandQueue.slice(-MAX_SPATIAL_COMMANDS);
        }

        broadcastCustomEvent({
          type: "office.peer_review",
          properties: { review, command },
        });
        broadcastCustomEvent({
          type: "office.spatial.command",
          properties: { command, whiteboard: spatialState.whiteboard },
        });

        sendJson(res, 200, {
          ok: true,
          dispatched: review.dispatched,
          dispatchError: review.dispatchError,
          targetSessionId: review.targetSessionId,
          limitReached: false,
          escalated: false,
          round,
          maxRounds: MAX_PEER_REVIEW_ROUNDS,
          chainKey: chain.key,
          review,
          command,
          clients: sseClients.size,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en peer-review" });
      }
      return;
    }
  }

  // Conciencia espacial 3D: sincronización de estado (frontend 3D <-> puente <-> MCP)
  if (reqPath === "/api/office/spatial-state" || reqPath === "/office/spatial-state") {
    if (req.method === "GET") {
      sendJson(res, 200, spatialState);
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const now = Date.now();

        if (body?.agentSessions && typeof body.agentSessions === "object") {
          for (const [rawId, sid] of Object.entries(body.agentSessions)) {
            const agentId = resolveAgentId(rawId);
            if (agentId && typeof sid === "string" && sid.trim()) {
              preferredAgentSessions[agentId] = sid.trim();
            }
          }
        }

        if (body?.agents && typeof body.agents === "object") {
          for (const [rawId, info] of Object.entries(body.agents)) {
            const agentId = resolveAgentId(rawId) || rawId;
            if (!agentId || !info || typeof info !== "object") continue;
            spatialState.agents[agentId] = {
              ...(spatialState.agents[agentId] || {}),
              ...info,
              id: agentId,
              updatedAt: Number(info.updatedAt) || now,
            };
          }
        }

        const incomingNotes = Array.isArray(body?.whiteboard?.notes)
          ? body.whiteboard.notes
          : [];
        const prevCount = spatialState.whiteboard.notes.length;
        spatialState.whiteboard.notes = mergeWhiteboardNotes(
          spatialState.whiteboard.notes,
          incomingNotes,
        );
        if (spatialState.whiteboard.notes.length !== prevCount) {
          savePersistedWhiteboard();
        }
        spatialState.whiteboard.updatedAt =
          spatialState.whiteboard.notes[0]?.createdAt || spatialState.whiteboard.updatedAt;
        spatialState.updatedAt = Number(body?.updatedAt) || now;
        spatialState.source = body?.source || "live-3d";

        sendJson(res, 200, {
          ok: true,
          updatedAt: spatialState.updatedAt,
          whiteboard: spatialState.whiteboard,
          pendingCommandsCount: spatialCommandQueue.length,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en spatial-state" });
      }
      return;
    }
  }

  // Conciencia espacial 3D: cola + SSE de intenciones espaciales (MCP -> puente -> escena 3D)
  if (reqPath === "/api/office/spatial-command" || reqPath === "/office/spatial-command") {
    if (req.method === "GET") {
      const ackId = searchParams.get("ack");
      if (ackId) {
        spatialCommandQueue = spatialCommandQueue.filter((cmd) => cmd.id !== ackId);
      }

      const peek = searchParams.get("peek") === "1" || searchParams.get("peek") === "true";
      const commands = peek ? [...spatialCommandQueue] : spatialCommandQueue.splice(0);
      sendJson(res, 200, {
        commands,
        whiteboard: spatialState.whiteboard,
      });
      return;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody(req);
        const rawType = String(body?.type || "").trim().toLowerCase();
        const type =
          rawType === "write_whiteboard" || rawType === "whiteboard" || rawType === "pizarra"
            ? "write_whiteboard"
            : "move";

        const agentId = resolveAgentId(body?.agentId || body?.agente || body?.agent);
        if (!agentId) {
          sendJson(res, 400, {
            ok: false,
            error: "Agente no reconocido. Usa architect, frontend, qa, backend o systems.",
          });
          return;
        }

        const meta = AGENT_META[agentId];
        const now = Date.now();
        spatialCommandSeq += 1;
        const commandId = `sc_${now}_${spatialCommandSeq}`;

        let command = null;
        if (type === "write_whiteboard") {
          const noteText = String(body?.note || body?.nota || body?.text || "").trim();
          if (!noteText) {
            sendJson(res, 400, {
              ok: false,
              error: "La nota para la pizarra no puede estar vacía.",
            });
            return;
          }

          const noteId = `wb_${now}_${spatialCommandSeq}`;
          const noteRecord = {
            id: noteId,
            agentId,
            agentName: meta.name,
            authorType: "agent",
            color: meta.color,
            text: noteText.slice(0, 240),
            createdAt: now,
          };

          spatialState.whiteboard.notes = mergeWhiteboardNotes(
            spatialState.whiteboard.notes,
            [noteRecord],
          );
          spatialState.whiteboard.updatedAt = now;
          savePersistedWhiteboard();

          command = {
            id: commandId,
            noteId,
            type: "write_whiteboard",
            agentId,
            agentName: meta.name,
            color: meta.color,
            note: noteRecord.text,
            createdAt: now,
          };
        } else {
          const destination = String(body?.destination || body?.destino || "").trim();
          if (!destination) {
            sendJson(res, 400, {
              ok: false,
              error: "Debes indicar un destino válido para moverte.",
            });
            return;
          }
          const reason = String(body?.reason || body?.motivo || "").trim();
          command = {
            id: commandId,
            type: "move",
            agentId,
            agentName: meta.name,
            color: meta.color,
            destination,
            reason: reason.slice(0, 80),
            createdAt: now,
          };
        }

        spatialCommandQueue.push(command);
        if (spatialCommandQueue.length > MAX_SPATIAL_COMMANDS) {
          spatialCommandQueue = spatialCommandQueue.slice(-MAX_SPATIAL_COMMANDS);
        }

        broadcastCustomEvent({
          type: "office.spatial.command",
          properties: {
            command,
            whiteboard: spatialState.whiteboard,
          },
        });

        sendJson(res, 200, {
          ok: true,
          command,
          whiteboard: spatialState.whiteboard,
          clients: sseClients.size,
        });
      } catch {
        sendJson(res, 400, { ok: false, error: "JSON inválido en spatial-command" });
      }
      return;
    }
  }

  // Endpoint opcional para plugins o scripts CLI que quieran inyectar eventos directos
  if (reqPath === "/office-event" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      broadcastCustomEvent(data);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, clients: sseClients.size }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "JSON inválido" }));
    }
    return;
  }

  const hasApiPrefix =
    reqPath === "/api" ||
    reqPath.startsWith("/api/") ||
    reqPath === "/openapi.json" ||
    reqPath === "/doc";
  const normalizedPath = hasApiPrefix
    ? detectedUpstreamPrefix === "" && reqPath.startsWith("/api/")
      ? reqPath.slice(4) || "/"
      : reqPath
    : detectedUpstreamPrefix
      ? `${detectedUpstreamPrefix}${reqPath.startsWith("/") ? reqPath : `/${reqPath}`}`
      : reqPath;

  await proxyHttp(req, res, `${OPENCODE_URL}${normalizedPath}${query}`);
});

server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  console.log(
    `[OpenCode Bridge] Escuchando en http://${BRIDGE_HOST}:${BRIDGE_PORT} -> ${OPENCODE_URL}`,
  );
});
