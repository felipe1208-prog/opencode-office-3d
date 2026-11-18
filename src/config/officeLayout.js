export const DIORAMA_CONFIG = {
  wallHeight: 3.8,
  wallThickness: 0.35,
  baseboardHeight: 0.16,

  // Suelo escalonado completo
  floorPolygon: [
    { x: -12.0, z: 9.0 },
    { x: -12.0, z: -8.5 },
    { x: -4.5, z: -8.5 },
    { x: -4.5, z: -9.2 },
    { x: 4.2, z: -9.2 },
    { x: 4.2, z: -8.5 },
    { x: 12.0, z: -8.5 },
    { x: 12.0, z: 9.0 },
    { x: -12.0, z: 9.0 },
  ],

  // Muros perimetrales continuos
  perimeterWalls: [
    {
      p1: { x: -12.0, z: 9.0 },
      p2: { x: -12.0, z: -8.5 },
      windows: [
        { offset: 3.2, width: 2.8, height: 2.1 },
        { offset: 8.0, width: 2.8, height: 2.1 },
        { offset: 13.5, width: 3.4, height: 2.1 },
      ],
    },
    {
      p1: { x: -12.0, z: -8.5 },
      p2: { x: -4.5, z: -8.5 },
      windows: [{ offset: 3.8, width: 3.4, height: 2.1 }],
    },
    { p1: { x: -4.5, z: -8.5 }, p2: { x: -4.5, z: -9.2 }, windows: [] },
    {
      p1: { x: -4.5, z: -9.2 },
      p2: { x: 4.2, z: -9.2 },
      windows: [],
    },
    { p1: { x: 4.2, z: -9.2 }, p2: { x: 4.2, z: -8.5 }, windows: [] },
    {
      p1: { x: 4.2, z: -8.5 },
      p2: { x: 12.0, z: -8.5 },
      windows: [{ offset: 5.5, width: 3.4, height: 2.1 }],
    },
    {
      p1: { x: 12.0, z: -8.5 },
      p2: { x: 12.0, z: 9.0 },
      windows: [
        { offset: 4.5, width: 3.2, height: 2.1 },
        { offset: 11.5, width: 3.2, height: 2.1 },
      ],
    },
  ],

  // Mamparas acústicas
  glassRooms: {
    supervisor: {
      minX: -12.0,
      maxX: -4.8,
      minZ: -8.5,
      maxZ: -2.8,
      doorGap: { start: -7.5, end: -5.9 },
    },
    meeting: {
      minX: -4.2,
      maxX: 4.2,
      minZ: -9.2,
      maxZ: -2.8,
      doorGap: { start: -0.8, end: 0.8 },
    },
  },

  // Muros interiores
  interiorWalls: {
    kitchenWall: {
      x: -2.0,
      startZ: 3.2,
      endZ: 7.8,
      height: 2.1,
      thickness: 0.28,
    },
    loungeTVWall: {
      startX: 4.8,
      endX: 12.0,
      z: 0.2,
      height: 2.6,
      thickness: 0.3,
    },
  },

  // Alfombras unificadas en tonos nórdicos pizarra / gris cálido
  carpets: [
    // Corredor vertical principal
    { width: 1.8, length: 8.8, x: -3.2, z: 3.2, color: "#273447" },

    // Corredor horizontal norte
    { width: 10.4, length: 1.8, x: -1.0, z: -1.8, color: "#273447" },

    // Sala de Reuniones
    { width: 6.8, length: 4.8, x: 0.0, z: -6.0, color: "#2B3A4E" },

    // Pod 1 (Bancada Oeste)
    { width: 3.2, length: 3.0, x: -9.6, z: 5.2, color: "#2A3646" },

    // Pod 2 (Bancada Central-Sur)
    { width: 3.2, length: 3.0, x: -6.0, z: 5.2, color: "#2A3646" },

    // Pod 3 (Isla Norte)
    { width: 2.2, length: 2.8, x: -7.8, z: 1.0, color: "#2A3646" },

    // Lounge
    { width: 6.4, length: 5.4, x: 8.2, z: 4.6, color: "#263344" },
  ],
};

export const AGENT_STATIONS = {
  architect: {
    id: "architect",
    name: "Tech Lead",
    role: "Architecture & Supervision",
    color: "#8B5CF6",
    checkpointId: "supervisor-desk",
    directory: "agents-workspace/architect/",
    position: { x: -8.4, y: 0.035, z: -6.5 },
    rotation: { y: 0 },
  },
  frontend: {
    id: "frontend",
    name: "Frontend Dev",
    role: "UI/UX & WebGL",
    color: "#EAB308",
    checkpointId: "dev-pod2-nw",
    directory: "agents-workspace/frontend/",
    position: { x: -6.7, y: 0.035, z: 4.18 },
    rotation: { y: 0 },
  },
  qa: {
    id: "qa",
    name: "DevOps / QA",
    role: "Database & Reliability",
    color: "#9333EA",
    checkpointId: "dev-pod2-ne",
    directory: "agents-workspace/qa/",
    position: { x: -5.3, y: 0.035, z: 4.18 },
    rotation: { y: 0 },
  },
  backend: {
    id: "backend",
    name: "Backend Dev",
    role: "API & Business Logic",
    color: "#0284C7",
    checkpointId: "dev-pod2-se",
    directory: "agents-workspace/backend/",
    position: { x: -5.3, y: 0.035, z: 6.22 },
    rotation: { y: Math.PI },
  },
  systems: {
    id: "systems",
    name: "Systems Dev",
    role: "CLI & Automation",
    color: "#EA580C",
    checkpointId: "dev-pod2-sw",
    directory: "agents-workspace/systems/",
    position: { x: -6.7, y: 0.035, z: 6.22 },
    rotation: { y: Math.PI },
  },
};
