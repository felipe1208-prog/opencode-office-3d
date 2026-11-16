import * as THREE from "three";

export class NavigationGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();

    this.initGraph();
  }

  addNode(id, x, z) {
    this.nodes.set(id, new THREE.Vector3(x, -0.34, z));
    this.edges.set(id, []);
  }

  connect(idA, idB) {
    if (this.edges.has(idA) && this.edges.has(idB)) {
      if (!this.edges.get(idA).includes(idB)) this.edges.get(idA).push(idB);
      if (!this.edges.get(idB).includes(idA)) this.edges.get(idB).push(idA);
    }
  }

  initGraph() {
    // -------------------------------------------------------------
    // 1. PASILLO CENTRAL VERTICAL (EJE PRINCIPAL Z)
    // -------------------------------------------------------------
    this.addNode("corridor-south", -2.35, 7.1);
    this.addNode("corridor-mid-south", -2.35, 5.2);
    this.addNode("corridor-mid-north", -2.35, 3.2);
    this.addNode("corridor-hub", -2.35, 1.8);
    this.addNode("corridor-north-link", -2.35, -1.6);

    this.connect("corridor-south", "corridor-mid-south");
    this.connect("corridor-mid-south", "corridor-mid-north");
    this.connect("corridor-mid-north", "corridor-hub");
    this.connect("corridor-hub", "corridor-north-link");

    // -------------------------------------------------------------
    // 2. ZONA DESARROLLO (POD 1, POD 2 Y POD 3)
    // -------------------------------------------------------------
    // Pod 2 (Bancada Central-Sur)
    this.addNode("dev2-aisle-nw", -6.7, 3.2);
    this.addNode("dev2-aisle-ne", -5.3, 3.2);
    this.addNode("dev2-exit-n", -3.8, 3.2);

    this.connect("dev2-aisle-nw", "dev2-aisle-ne");
    this.connect("dev2-aisle-ne", "dev2-exit-n");
    this.connect("dev2-exit-n", "corridor-mid-north");

    this.addNode("dev2-aisle-sw", -6.7, 7.1);
    this.addNode("dev2-aisle-se", -5.3, 7.1);
    this.addNode("dev2-exit-s", -3.8, 7.1);

    this.connect("dev2-aisle-sw", "dev2-aisle-se");
    this.connect("dev2-aisle-se", "dev2-exit-s");
    this.connect("dev2-exit-s", "corridor-south");

    // Pod 1 (Bancada Oeste)
    this.addNode("dev1-aisle-nw", -10.3, 3.2);
    this.addNode("dev1-aisle-ne", -8.9, 3.2);
    this.addNode("dev1-aisle-sw", -10.3, 7.1);
    this.addNode("dev1-aisle-se", -8.9, 7.1);

    this.connect("dev1-aisle-nw", "dev1-aisle-ne");
    this.connect("dev1-aisle-ne", "dev2-aisle-nw");
    this.connect("dev1-aisle-sw", "dev1-aisle-se");
    this.connect("dev1-aisle-se", "dev2-aisle-sw");

    // Paso oeste libre alrededor de Pod 1 y Pod 3 (sin atravesar escritorios)
    this.addNode("dev-west-lane-south", -10.9, 5.2);
    this.addNode("dev-west-lane-north", -10.3, 1.0);
    this.connect("dev1-aisle-sw", "dev-west-lane-south");
    this.connect("dev-west-lane-south", "dev1-aisle-nw");
    this.connect("dev1-aisle-nw", "dev-west-lane-north");

    // Pod 3 (Isla Norte en X = -7.8, Z = 1.0)
    this.addNode("dev3-aisle-s", -7.8, 2.75);
    this.addNode("dev3-aisle-n", -7.8, -1.6);
    this.addNode("dev3-east-pass", -5.6, 1.0);

    this.connect("dev1-aisle-ne", "dev3-aisle-s");
    this.connect("dev3-aisle-s", "dev2-aisle-nw");
    this.connect("dev3-aisle-s", "dev3-east-pass");
    this.connect("dev3-east-pass", "dev3-aisle-n");
    this.connect("dev3-east-pass", "corridor-hub");
    this.connect("dev-west-lane-north", "dev3-aisle-n");

    // -------------------------------------------------------------
    // 3. CORREDOR NORTE (Z = -1.6) CONECTANDO TODAS LAS SALAS
    // -------------------------------------------------------------
    this.addNode("north-corridor-supervisor", -6.7, -1.6);
    this.addNode("north-corridor-mid", -4.2, -1.6);
    this.addNode("north-corridor-meeting", 0.0, -1.6);
    this.addNode("north-corridor-east", 3.2, -1.6);

    this.connect("dev3-aisle-n", "north-corridor-supervisor");
    this.connect("north-corridor-supervisor", "north-corridor-mid");
    this.connect("north-corridor-mid", "corridor-north-link");
    this.connect("corridor-north-link", "north-corridor-meeting");
    this.connect("north-corridor-meeting", "north-corridor-east");

    // -------------------------------------------------------------
    // 4. OFICINA DE SUPERVISOR (PORTAL X = -6.7, Z = -2.8)
    // -------------------------------------------------------------
    this.addNode("supervisor-door", -6.7, -2.8);
    this.addNode("supervisor-foyer", -6.7, -3.75);
    this.addNode("supervisor-south-aisle", -8.4, -3.75);
    this.addNode("supervisor-west-aisle", -10.1, -5.6);
    this.addNode("supervisor-north-aisle", -8.4, -7.25);
    this.addNode("supervisor-east-aisle", -5.5, -4.6);
    this.addNode("supervisor-bookcase-front", -5.5, -6.75);

    this.connect("north-corridor-supervisor", "supervisor-door");
    this.connect("supervisor-door", "supervisor-foyer");
    this.connect("supervisor-foyer", "supervisor-south-aisle");
    this.connect("supervisor-south-aisle", "supervisor-west-aisle");
    this.connect("supervisor-west-aisle", "supervisor-north-aisle");
    this.connect("supervisor-foyer", "supervisor-east-aisle");
    this.connect("supervisor-east-aisle", "supervisor-bookcase-front");
    this.connect("supervisor-north-aisle", "supervisor-bookcase-front");

    // -------------------------------------------------------------
    // 5. SALA DE REUNIONES (PORTAL X = 0.0, Z = -2.8)
    // -------------------------------------------------------------
    this.addNode("meeting-door", 0.0, -2.8);
    this.addNode("meeting-foyer", 0.0, -3.8);
    this.addNode("meeting-south-w", -1.45, -4.15);
    this.addNode("meeting-south-e", 1.45, -4.15);
    this.addNode("meeting-corner-sw", -3.15, -4.15);
    this.addNode("meeting-corner-se", 3.15, -4.15);
    this.addNode("meeting-corner-nw", -3.15, -7.75);
    this.addNode("meeting-corner-ne", 3.15, -7.75);
    this.addNode("meeting-north-w", -1.45, -7.75);
    this.addNode("meeting-north-e", 1.45, -7.75);
    this.addNode("meeting-presenter-aisle", 0.0, -7.75);

    this.connect("north-corridor-meeting", "meeting-door");
    this.connect("meeting-door", "meeting-foyer");
    this.connect("meeting-foyer", "meeting-south-w");
    this.connect("meeting-foyer", "meeting-south-e");
    this.connect("meeting-south-w", "meeting-corner-sw");
    this.connect("meeting-corner-sw", "meeting-corner-nw");
    this.connect("meeting-corner-nw", "meeting-north-w");
    this.connect("meeting-north-w", "meeting-presenter-aisle");
    this.connect("meeting-south-e", "meeting-corner-se");
    this.connect("meeting-corner-se", "meeting-corner-ne");
    this.connect("meeting-corner-ne", "meeting-north-e");
    this.connect("meeting-north-e", "meeting-presenter-aisle");

    // -------------------------------------------------------------
    // 6. CRUCE ESTE-OESTE (PROMENADE CENTRAL LIBRE DE PAREDES)
    // -------------------------------------------------------------
    this.addNode("promenade-kitchen-entry", -0.8, 1.8);
    this.addNode("promenade-center", 1.6, 1.8);
    this.addNode("promenade-east", 4.3, 1.8);

    this.connect("corridor-hub", "promenade-kitchen-entry");
    this.connect("promenade-kitchen-entry", "promenade-center");
    this.connect("promenade-center", "promenade-east");

    // -------------------------------------------------------------
    // 7. COCINA Y COFFEE BAR
    // -------------------------------------------------------------
    this.addNode("kitchen-aisle-cooler", -0.8, 3.8);
    this.addNode("kitchen-aisle-drip", -0.8, 5.75);
    this.addNode("kitchen-aisle-espresso", -0.8, 6.45);
    this.addNode("kitchen-aisle-fridge", -0.8, 7.35);

    this.connect("promenade-kitchen-entry", "kitchen-aisle-cooler");
    this.connect("kitchen-aisle-cooler", "kitchen-aisle-drip");
    this.connect("kitchen-aisle-drip", "kitchen-aisle-espresso");
    this.connect("kitchen-aisle-espresso", "kitchen-aisle-fridge");

    // Pasillo exterior para los taburetes de la barra (al este de la barra)
    this.addNode("barstools-aisle-north", 1.6, 4.9);
    this.addNode("barstools-aisle-mid", 1.6, 5.9);
    this.addNode("barstools-aisle-south", 1.6, 7.0);

    this.connect("promenade-center", "barstools-aisle-north");
    this.connect("barstools-aisle-north", "barstools-aisle-mid");
    this.connect("barstools-aisle-mid", "barstools-aisle-south");

    // -------------------------------------------------------------
    // 8. ZONA PING-PONG Y ARCADE (PORTAL LIBRE EN X = 4.30 -> 4.80)
    // -------------------------------------------------------------
    this.addNode("pingpong-door-outside", 4.3, 0.2);
    this.addNode("pingpong-door-inside", 4.8, -1.6);

    this.connect("promenade-east", "pingpong-door-outside");
    this.connect("pingpong-door-outside", "pingpong-door-inside");
    this.connect("north-corridor-east", "pingpong-door-inside");

    this.addNode("pingpong-arcade-front", 6.2, -1.6);
    this.addNode("pingpong-vending-front", 9.5, -1.6);
    this.addNode("pingpong-table-south", 7.5, -2.55);
    this.addNode("pingpong-west-aisle", 5.55, -4.5);
    this.addNode("pingpong-table-north", 7.5, -6.55);
    this.addNode("pingpong-spectator-lounge", 9.8, -4.5);
    this.addNode("pingpong-bench-front", 8.1, -7.55);

    this.connect("pingpong-door-inside", "pingpong-arcade-front");
    this.connect("pingpong-arcade-front", "pingpong-vending-front");
    this.connect("pingpong-arcade-front", "pingpong-table-south");
    this.connect("pingpong-door-inside", "pingpong-west-aisle");
    this.connect("pingpong-west-aisle", "pingpong-table-north");
    this.connect("pingpong-table-north", "pingpong-bench-front");
    this.connect("pingpong-table-south", "pingpong-spectator-lounge");
    this.connect("pingpong-spectator-lounge", "pingpong-vending-front");
    this.connect("pingpong-bench-front", "pingpong-spectator-lounge");

    // -------------------------------------------------------------
    // 9. LOUNGE MULTIMEDIA (CIRCULACIÓN PERIMETRAL)
    // -------------------------------------------------------------
    this.addNode("lounge-entry", 5.6, 2.4);
    this.addNode("lounge-north-aisle", 8.0, 2.4);
    this.addNode("lounge-east-aisle", 10.65, 4.15);
    this.addNode("lounge-south-aisle", 8.0, 6.65);
    this.addNode("lounge-west-aisle", 5.45, 4.15);

    this.connect("promenade-east", "lounge-entry");
    this.connect("lounge-entry", "lounge-north-aisle");
    this.connect("lounge-north-aisle", "lounge-east-aisle");
    this.connect("lounge-east-aisle", "lounge-south-aisle");
    this.connect("lounge-south-aisle", "lounge-west-aisle");
    this.connect("lounge-west-aisle", "lounge-entry");
  }

  getClosestNodeId(pos) {
    let closestId = null;
    let minDist = Infinity;
    const p = new THREE.Vector2(pos.x, pos.z);

    for (const [id, vec] of this.nodes.entries()) {
      const dist = p.distanceTo(new THREE.Vector2(vec.x, vec.z));
      if (dist < minDist) {
        minDist = dist;
        closestId = id;
      }
    }
    return closestId;
  }
}

export const navGraph = new NavigationGraph();
