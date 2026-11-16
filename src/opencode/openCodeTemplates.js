export const DEFAULT_AGENT_ALIASES = {
  architect: ["architect", "tech-lead", "lead", "orchestrator", "plan", "build", "main"],
  frontend: ["frontend", "frontend-dev", "ui", "ux", "webgl", "threejs"],
  qa: ["qa", "devops", "reviewer", "code-reviewer", "test", "audit"],
  backend: ["backend", "backend-dev", "api", "server", "db"],
  systems: ["systems", "systems-dev", "cli", "automation", "infra"],
};

export const OPENCODE_JSON_SNIPPET = `{
  "$schema": "https://opencode.ai/config.json",
  "default_agent": "architect",
  "server": {
    "port": 4096,
    "hostname": "127.0.0.1",
    "cors": [
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ]
  },
  "agent": {
    "architect": {
      "description": "Tech Lead que coordina arquitectura y delega tareas.",
      "mode": "primary",
      "prompt": "Eres Tech Lead (architect). Analiza el problema y delega en @frontend, @backend, @qa o @systems usando la herramienta task."
    },
    "frontend": {
      "description": "UI/UX, componentes web y escenas Three.js/WebGL.",
      "mode": "subagent",
      "prompt": "Eres Frontend Dev (@frontend). Implementas vistas, estilos y módulos 3D."
    },
    "qa": {
      "description": "Pruebas automatizadas, auditoría y revisión de código.",
      "mode": "subagent",
      "prompt": "Eres DevOps / QA (@qa). Verificas tests, compilación y calidad."
    },
    "backend": {
      "description": "APIs, persistencia y lógica de negocio.",
      "mode": "subagent",
      "prompt": "Eres Backend Dev (@backend). Diseñas rutas, validaciones y servicios."
    },
    "systems": {
      "description": "CLI, scripts, automatización e infraestructura.",
      "mode": "subagent",
      "prompt": "Eres Systems Dev (@systems). Construyes scripts CLI y puentes de integración."
    }
  }
}`;

export const OPENCODE_CLI_COMMANDS = {
  serveDirect:
    "opencode serve --port 4096 --cors http://localhost:3000 --cors http://127.0.0.1:3000",
  runBridge: "npm run opencode:bridge",
  attachTui: "opencode attach http://127.0.0.1:4096",
};
