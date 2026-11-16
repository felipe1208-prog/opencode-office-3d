import * as THREE from "three";

export const ANIMATION_DEFS = {
  // Base y locomoción
  typing: { resource: "animTyping", loop: THREE.LoopRepeat, speed: 1.0 },
  sittingIdle: {
    resource: "animSittingIdle",
    loop: THREE.LoopRepeat,
    speed: 0.85,
  },
  standingIdle: {
    resource: "animStandingIdle",
    loop: THREE.LoopRepeat,
    speed: 0.85,
  },
  walking: { resource: "animWalking", loop: THREE.LoopRepeat, speed: 1.15 },
  walkingTurn180: {
    resource: "animWalkingTurn180",
    loop: THREE.LoopOnce,
    speed: 1.1,
    next: "standingIdle",
  },
  sitToType: {
    resource: "animSitToType",
    loop: THREE.LoopOnce,
    speed: 1.0,
    next: "typing",
  },
  typeToSit: {
    resource: "animTypeToSit",
    loop: THREE.LoopOnce,
    speed: 1.0,
    next: "sittingIdle",
  },
  sitToStand: { resource: "animSitToStand", loop: THREE.LoopOnce, speed: 1.1 },
  standToSit: { resource: "animStandToSit", loop: THREE.LoopOnce, speed: 1.1 },

  // Interacción, reacciones y ocio (completando los 17 FBX de Mixamo)
  buttonPushing: {
    resource: "animButtonPushing",
    loop: THREE.LoopRepeat,
    speed: 1.0,
  },
  sittingCheer: {
    resource: "animSittingCheer",
    loop: THREE.LoopOnce,
    speed: 1.0,
    next: "typing",
  },
  drinking: {
    resource: "animDrinking",
    loop: THREE.LoopRepeat,
    speed: 0.95,
  },
  pointing: {
    resource: "animPointing",
    loop: THREE.LoopRepeat,
    speed: 0.95,
  },
  sittingDisbelief: {
    resource: "animSittingDisbelief",
    loop: THREE.LoopOnce,
    speed: 1.0,
    next: "typing",
  },
  sittingTalking: {
    resource: "animSittingTalking",
    loop: THREE.LoopRepeat,
    speed: 0.95,
  },
  talking: {
    resource: "animTalking",
    loop: THREE.LoopRepeat,
    speed: 1.0,
  },
  texting: {
    resource: "animTexting",
    loop: THREE.LoopRepeat,
    speed: 0.95,
  },
};

export const ACTION_PROFILES = {
  typing: { anim: "typing", prop: null, label: "Tecleando código" },
  sittingIdle: { anim: "sittingIdle", prop: null, label: "En reposo" },
  standingIdle: { anim: "standingIdle", prop: null, label: "De pie en espera" },
  makeCoffee: {
    anim: "buttonPushing",
    prop: "coffeeMug",
    label: "Preparando café",
  },
  drinkCoffee: {
    anim: "drinking",
    prop: "coffeeMug",
    label: "Tomando café",
  },
  drinkWater: {
    anim: "drinking",
    prop: "waterGlass",
    label: "Hidratándose",
  },
  openFridge: {
    anim: "buttonPushing",
    prop: "sodaCan",
    label: "Abriendo nevera",
  },
  washHands: {
    anim: "buttonPushing",
    prop: null,
    label: "En fregadero",
  },
  playArcade: {
    anim: "buttonPushing",
    prop: null,
    label: "Jugando Arcade",
  },
  buyVending: {
    anim: "buttonPushing",
    prop: "sodaCan",
    label: "Máquina expendedora",
  },
  viewTournament: {
    anim: "pointing",
    prop: "clipboard",
    label: "Revisando pizarra",
  },
  playPingPong: {
    anim: "pointing",
    prop: "pingPongPaddle",
    label: "Partida de Ping-Pong",
  },
  presenting: {
    anim: "talking",
    prop: "clipboard",
    label: "Presentando en reunión",
  },
  listening: {
    anim: "sittingTalking",
    prop: null,
    label: "En reunión",
  },
  watchTV: {
    anim: "sittingIdle",
    prop: "tvRemote",
    label: "Descansando en Lounge",
  },
  browseBooks: {
    anim: "pointing",
    prop: "clipboard",
    label: "Consultando archivo",
  },
  texting: {
    anim: "texting",
    prop: "smartphone",
    label: "Revisando móvil",
  },
  buttonPushing: {
    anim: "buttonPushing",
    prop: null,
    label: "Operando consola",
  },
  drinking: {
    anim: "drinking",
    prop: "coffeeMug",
    label: "Bebiendo",
  },
  pointing: {
    anim: "pointing",
    prop: "clipboard",
    label: "Señalando objetivo",
  },
  talking: {
    anim: "talking",
    prop: null,
    label: "Conversando de pie",
  },
  sittingTalking: {
    anim: "sittingTalking",
    prop: null,
    label: "Conversando sentado",
  },
  sittingCheer: {
    anim: "sittingCheer",
    prop: null,
    label: "Festejando logro",
  },
  sittingDisbelief: {
    anim: "sittingDisbelief",
    prop: null,
    label: "Revisando incidente",
  },
  walkingTurn180: {
    anim: "walkingTurn180",
    prop: null,
    label: "Giro en corredor",
  },
  deskReview: {
    anim: "pointing",
    prop: "clipboard",
    label: "Revisión en escritorio",
  },
  pairChat: {
    anim: "talking",
    prop: "coffeeMug",
    label: "Charla en pareja",
  },
  pairChatSeated: {
    anim: "sittingTalking",
    prop: null,
    label: "Charla en pareja",
  },
};

export const PROP_DEFS = {
  coffeeMug: {
    label: "Taza de café",
    hand: "right",
    assetName: "coffeeMug",
    maxDim: 0.088,
    offset: [0.015, 0.068, 0.032],
    rotation: [0.1, 0, -Math.PI / 2],
  },
  waterGlass: {
    label: "Vaso de agua",
    hand: "right",
    assetName: "waterGlass",
    maxDim: 0.085,
    offset: [0.012, 0.068, 0.03],
    rotation: [0.1, 0, -Math.PI / 2],
  },
  sodaCan: {
    label: "Lata fría",
    hand: "right",
    assetName: "sodaCan",
    maxDim: 0.09,
    offset: [0.012, 0.065, 0.032],
    rotation: [0.12, 0, -Math.PI / 2],
  },
  tvRemote: {
    label: "Control remoto",
    hand: "right",
    assetName: "tvRemote",
    maxDim: 0.13,
    offset: [0.015, 0.065, 0.03],
    rotation: [Math.PI / 2, 0.2, 0],
  },
  pingPongPaddle: {
    label: "Pala de Ping-Pong",
    hand: "right",
    procedural: "pingPongPaddle",
    offset: [0.012, 0.068, 0.025],
    rotation: [Math.PI / 2, 0.25, -Math.PI / 2],
  },
  smartphone: {
    label: "Smartphone",
    hand: "right",
    procedural: "smartphone",
    offset: [0.01, 0.072, 0.035],
    rotation: [-0.45, 0.2, -0.2],
  },
  clipboard: {
    label: "Portapapeles",
    hand: "left",
    procedural: "clipboard",
    offset: [-0.01, 0.075, 0.035],
    rotation: [Math.PI / 2 - 0.25, 0, 0.15],
  },
};

export const AGENTS_CONFIG = [
  {
    id: "architect",
    name: "Tech Lead",
    role: "Architecture & Supervision",
    color: "#8B5CF6",
    homeCheckpointId: "supervisor-desk",
    initialAnimation: "typing",
    directory: "agents-workspace/architect/",
  },
  {
    id: "frontend",
    name: "Frontend Dev",
    role: "UI/UX & WebGL",
    color: "#EAB308",
    homeCheckpointId: "dev-pod2-nw",
    initialAnimation: "typing",
    directory: "agents-workspace/frontend/",
  },
  {
    id: "qa",
    name: "DevOps / QA",
    role: "Database & Reliability",
    color: "#9333EA",
    homeCheckpointId: "dev-pod2-ne",
    initialAnimation: "typing",
    directory: "agents-workspace/qa/",
  },
  {
    id: "backend",
    name: "Backend Dev",
    role: "API & Business Logic",
    color: "#0284C7",
    homeCheckpointId: "dev-pod2-se",
    initialAnimation: "typing",
    directory: "agents-workspace/backend/",
  },
  {
    id: "systems",
    name: "Systems Dev",
    role: "CLI & Automation",
    color: "#EA580C",
    homeCheckpointId: "dev-pod2-sw",
    initialAnimation: "typing",
    directory: "agents-workspace/systems/",
  },
];
