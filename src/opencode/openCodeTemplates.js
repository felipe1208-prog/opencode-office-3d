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
  "mcp": {
    "office-spatial": {
      "type": "local",
      "command": ["node", "mcp/office-spatial-server.js"],
      "environment": {
        "OFFICE_BRIDGE_URL": "http://127.0.0.1:4097"
      },
      "enabled": true
    }
  },
  "agent": {
    "architect": {
      "description": "Tech Lead que coordina arquitectura y delega tareas.",
      "mode": "primary",
      "prompt": "Eres Tech Lead (architect). Analiza el problema y delega en @frontend, @backend, @qa o @systems usando la herramienta task. Si hay decisiones de negocio o arquitectura ambiguas, pregunta primero al usuario. Habitas una oficina 3D compartida y dispones de las herramientas MCP observar_oficina, moverse_a y escribir_en_pizarra: úsalas cuando aporten valor real (ej. anotar acuerdos técnicos en la pizarra, acercarte a un compañero o a la sala de reuniones) o cuando el usuario te pregunte dónde estás o qué hay alrededor."
    },
    "frontend": {
      "description": "UI/UX, componentes web y escenas Three.js/WebGL.",
      "mode": "all",
      "prompt": "Eres Frontend Dev (@frontend). Implementas vistas, estilos y módulos 3D. Cuando recibas una tarea delegada con ambigüedades visuales, de paleta, layout o interacción, detente y haz una pregunta breve y concreta al usuario (usando la herramienta question o un mensaje directo claro) antes de asumir en silencio. Dispones de las herramientas MCP observar_oficina, moverse_a y escribir_en_pizarra para percibir tu entorno en la oficina 3D, desplazarte junto a un compañero o consultar/anotar en la pizarra cuando aporte a la tarea o el usuario lo pida."
    },
    "qa": {
      "description": "Pruebas automatizadas, auditoría y revisión de código.",
      "mode": "all",
      "prompt": "Eres DevOps / QA (@qa). Verificas tests, compilación y calidad. Si falta criterio de aceptación o alcance de pruebas en una tarea delegada, formula una pregunta breve al usuario antes de continuar. Puedes usar observar_oficina, moverse_a y escribir_en_pizarra cuando aporte valor durante revisiones con el equipo o si el usuario pregunta por tu ubicación en la oficina 3D."
    },
    "backend": {
      "description": "APIs, persistencia y lógica de negocio.",
      "mode": "all",
      "prompt": "Eres Backend Dev (@backend). Diseñas rutas, validaciones y servicios. Cuando falten definiciones de esquema, endpoints o reglas de negocio en una tarea delegada, detente y pregunta al usuario de forma breve y concreta (mediante question o mensaje directo). Puedes usar observar_oficina, moverse_a y escribir_en_pizarra para consultar acuerdos de arquitectura en la pizarra, acercarte a compañeros o ubicarte en la oficina 3D cuando sea útil o el usuario lo solicite."
    },
    "systems": {
      "description": "CLI, scripts, automatización e infraestructura.",
      "mode": "all",
      "prompt": "Eres Systems Dev (@systems). Construyes scripts CLI y puentes de integración. Si existen dudas sobre rutas, entornos o permisos requeridos, consulta brevemente al usuario antes de ejecutar cambios. Puedes usar observar_oficina, moverse_a y escribir_en_pizarra para orientarte en la oficina 3D o coordinar notas técnicas en la pizarra cuando aporte a la tarea o el usuario te lo pida."
    }
  }
}`;

export const OPENCODE_CLI_COMMANDS = {
  serveDirect:
    "opencode serve --port 4096 --cors http://localhost:3000 --cors http://127.0.0.1:3000",
  runBridge: "npm run opencode:bridge",
  attachTui: "opencode attach http://127.0.0.1:4096",
};

export function buildOpenCodeSetupReport({
  profiles = [],
  aliases = DEFAULT_AGENT_ALIASES,
  mode = "direct",
  url = "http://127.0.0.1:4096",
} = {}) {
  const agentRows = (
    profiles.length > 0
      ? profiles
      : [
          { id: "architect", name: "Tech Lead", role: "Architecture & Supervision" },
          { id: "frontend", name: "Frontend Dev", role: "UI/UX & WebGL" },
          { id: "qa", name: "DevOps / QA", role: "Database & Reliability" },
          { id: "backend", name: "Backend Dev", role: "API & Business Logic" },
          { id: "systems", name: "Systems Dev", role: "CLI & Automation" },
        ]
  )
    .map((p) => {
      const list = Array.isArray(aliases[p.id]) ? aliases[p.id].join(", ") : p.id;
      const modeLabel = p.id === "architect" ? "primary" : "all";
      return `| \`${p.id}\` | ${p.name} | ${p.role} | \`${modeLabel}\` | ${list} |`;
    })
    .join("\n");

  return `# Reporte de Configuración: OpenCode CLI + Oficina Virtual 3D

Este documento reúne todo lo necesario para configurar los **5 agentes** en tu instalación local de **OpenCode** y conectarlos en tiempo real con la **Oficina Virtual 3D**.

---

## 1. Mapa de los 5 Agentes de la Oficina

| ID en OpenCode | Avatar en Oficina 3D | Especialidad | Modo sugerido | Alias reconocidos automáticamente |
| :--- | :--- | :--- | :--- | :--- |
${agentRows}

> Si en tu OpenCode ya tienes agentes con otros nombres (por ejemplo \`code-reviewer\` o \`ui\`), puedes añadirlos separados por coma en **Ajustes → Mapeo de agentes** sin modificar el código de OpenCode.

---

## 2. Dónde colocar la configuración (\`opencode.json\`)

Tienes dos opciones según quieras aplicarlo a un proyecto concreto o a todo tu equipo:

1. **Por proyecto (recomendado):** guarda el archivo como \`opencode.json\` en la **raíz del repositorio** donde trabajas con OpenCode.
2. **Global (para cualquier carpeta):**
   - **macOS / Linux:** \`~/.config/opencode/opencode.json\`
   - **Windows (PowerShell):** \`$env:USERPROFILE\\.config\\opencode\\opencode.json\`

### Contenido completo de \`opencode.json\`

\`\`\`json
${OPENCODE_JSON_SNIPPET}
\`\`\`

---

## 3. Alternativa modular: archivos Markdown en \`.opencode/agents/\`

Si prefieres definir cada agente en su propio archivo Markdown dentro de \`.opencode/agents/\` (o \`~/.config/opencode/agents/\`), crea uno por cada ID:

- **\`.opencode/agents/architect.md\`**
  \`\`\`markdown
  ---
  description: Tech Lead que coordina arquitectura y delega tareas.
  mode: primary
  ---
  Eres Tech Lead (architect). Analiza requerimientos y delega tareas especializadas en @frontend, @backend, @qa y @systems mediante la herramienta task.
  \`\`\`

- **\`.opencode/agents/frontend.md\`** (\`mode: all\` — permite recibir delegaciones y conversar directo con el usuario cuando tenga dudas visuales o funcionales)
- **\`.opencode/agents/qa.md\`** (\`mode: all\`)
- **\`.opencode/agents/backend.md\`** (\`mode: all\`)
- **\`.opencode/agents/systems.md\`** (\`mode: all\`)

> **Importante para consultas proactivas:** incluye en las instrucciones de tus agentes que, ante cualquier ambigüedad visual o funcional en una tarea delegada, detengan un momento y hagan una pregunta breve y concreta al usuario usando \`question\` o un mensaje directo antes de asumir en silencio.

*(Nota: si usas la alternativa Markdown, recuerda mantener los bloques \`"server"\` y \`"mcp"\` dentro de \`opencode.json\`).*

---

## 4. Conciencia Espacial 3D (MCP \`office-spatial\`)

El bloque \`"mcp"\` incluido arriba registra \`mcp/office-spatial-server.js\` (servidor MCP local por \`stdio\` sin dependencias externas) conectado al puente local \`http://127.0.0.1:4097\`.

Herramientas disponibles para los 5 agentes:
- \`observar_oficina(agente)\`: consulta zona actual en la oficina 3D, coordenadas \`(x, z)\`, postura, objetos cercanos (\`<= 2.5m\`), compañeros próximos y notas visibles en la pizarra.
- \`moverse_a(agente, destino, motivo)\`: camina hacia \`escritorio\`, \`pizarra\`, \`sala_reuniones\`, \`cafe\`, \`lounge\`, \`ping_pong\`, \`arcade\`, o junto a otro compañero (\`frontend\`, \`backend\`, \`qa\`, \`systems\`, \`architect\`).
- \`escribir_en_pizarra(agente, nota)\`: camina a la Sala de Reuniones y publica una nota técnica en la **Pizarra de Arquitectura 3D** compartida.

---

## 5. Cómo arrancar y conectar la Oficina Virtual 3D

### Opción A — Conexión directa (\`opencode serve\` en puerto 4096)

1. Abre una terminal en el proyecto donde vas a programar y ejecuta:
   \`\`\`bash
   ${OPENCODE_CLI_COMMANDS.serveDirect}
   \`\`\`
   *(Si abres la app desde una URL remota o un puerto diferente a \`3000\`, añade también \`--cors https://TU_DOMINIO\` o usa la Opción B).*

2. En una segunda terminal, abre la TUI de OpenCode conectada a ese servidor:
   \`\`\`bash
   ${OPENCODE_CLI_COMMANDS.attachTui}
   \`\`\`

3. En la **Oficina Virtual 3D**, pulsa el botón **OpenCode**, selecciona **Directo :4096**, pulsa **Probar conexión** y luego **Conectar**.
   *(Opcional: inicia también \`${OPENCODE_CLI_COMMANDS.runBridge}\` en otra terminal si quieres que los agentes usen las herramientas MCP espaciales en vivo).*

### Opción B — Mediante Puente Local Node (puerto 4097, recomendado para CORS, Basic Auth y MCP Espacial)

1. Inicia \`opencode serve\` (opcionalmente protegido con \`OPENCODE_SERVER_USERNAME\` y \`OPENCODE_SERVER_PASSWORD\`):
   \`\`\`bash
   opencode serve --port 4096
   \`\`\`
2. En otra terminal dentro del proyecto de la Oficina Virtual 3D, arranca el puente local sin dependencias externas:
   \`\`\`bash
   ${OPENCODE_CLI_COMMANDS.runBridge}
   \`\`\`
3. En la **Oficina Virtual 3D**, elige **Puente :4097** (URL \`http://127.0.0.1:4097\`) y pulsa **Conectar**.

---

## 6. Cómo funciona el Modo Híbrido y la delegación de subagentes

- **Configuración activa detectada al generar este reporte:** modo \`${mode}\` · URL \`${url}\`.
- Cuando \`architect\` ejecuta una llamada con la herramienta \`task\` (o abre una sesión hija con \`parentID\`) invocando a \`@frontend\`, \`@backend\`, \`@qa\` o \`@systems\`:
  1. El avatar asignado interrumpe limpiamente cualquier descanso o desplazamiento en curso y libera su checkpoint anterior.
  2. Camina por los pasillos A* hasta su escritorio y activa sus monitores duales y burbuja 3D al sentarse.
  3. Los agentes que no tienen trabajo activo en OpenCode continúan con sus pausas autónomas (café, lounge, ping-pong) hasta ser invocados.
  4. Al terminar (\`session.idle\`), el avatar celebra brevemente y permanece en su puesto durante el tiempo de *cooldown* antes de volver al descanso.

---

## 7. Verificación rápida y solución de problemas

- **No responde \`Probar conexión\`:** verifica que \`opencode serve\` esté escuchando en el puerto \`4096\` y que hayas iniciado con \`--cors\` incluyendo tu origen exacto (o usa \`npm run opencode:bridge\`).
- **Error \`401 Unauthorized\`:** introduce el mismo usuario y contraseña de \`OPENCODE_SERVER_USERNAME\` / \`OPENCODE_SERVER_PASSWORD\` en el panel **OpenCode**.
- **Los eventos llegan todos al mismo avatar:** revisa que tus subagentes usen los IDs \`frontend\`, \`qa\`, \`backend\`, \`systems\` o agrega los nombres reales de tus agentes en **OpenCode → Mapeo (5 Agentes)**.
- **Las herramientas MCP espaciales dicen puente sin conexión:** ejecuta \`npm run opencode:bridge\` desde la carpeta del proyecto para activar \`http://127.0.0.1:4097\`.
`;
}
