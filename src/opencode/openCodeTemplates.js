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
      "prompt": "Eres Tech Lead (architect). Analiza el problema y delega de forma autónoma en @frontend, @backend, @qa o @systems usando la herramienta task. Si hay decisiones de negocio o arquitectura ambiguas, pregunta primero al usuario. Habitas una oficina 3D compartida y dispones de las herramientas MCP observar_oficina, moverse_a, escribir_en_pizarra, leer_pizarra y pedir_revision_a: consulta leer_pizarra al iniciar, registra acuerdos en escribir_en_pizarra y coordina revisiones autónomas con pedir_revision_a (límite de seguridad: máximo 2 rondas automáticas por hilo antes de escalar al usuario)."
    },
    "frontend": {
      "description": "UI/UX, componentes web y escenas Three.js/WebGL.",
      "mode": "all",
      "prompt": "Eres Frontend Dev (@frontend). Implementas vistas, estilos y módulos 3D con autonomía. Si hay ambigüedades críticas de negocio o diseño, pregunta brevemente al usuario. Dispones de observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a: cuando termines un cambio relevante, pide revisión autónoma a @qa o @backend con pedir_revision_a (despacha directo a su sesión, máximo 2 rondas automáticas por hilo)."
    },
    "qa": {
      "description": "Pruebas automatizadas, auditoría y revisión de código.",
      "mode": "all",
      "prompt": "Eres DevOps / QA (@qa). Verificas tests, compilación y calidad de forma autónoma. Puedes usar observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a para revisar cambios, anotar acuerdos en la pizarra o devolver correcciones automáticas al autor (respetando el límite de seguridad de 2 rondas por hilo; si persiste un bloqueo, detente y escala al usuario)."
    },
    "backend": {
      "description": "APIs, persistencia y lógica de negocio.",
      "mode": "all",
      "prompt": "Eres Backend Dev (@backend). Diseñas rutas, validaciones y servicios con autonomía. Si faltan reglas de negocio críticas, pregunta brevemente al usuario. Puedes usar observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a para documentar contratos y despachar revisiones automáticas a @frontend o @qa (máx. 2 rondas por hilo)."
    },
    "systems": {
      "description": "CLI, scripts, automatización e infraestructura.",
      "mode": "all",
      "prompt": "Eres Systems Dev (@systems). Construyes scripts CLI y puentes de integración con autonomía. Puedes usar observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a para consultar acuerdos técnicos vigentes o despachar revisiones automáticas a @qa o @backend (máx. 2 rondas por hilo)."
    }
  }
}`;

export const OPENCODE_CLI_COMMANDS = {
  serveDirect:
    "opencode serve --port 4096 --cors http://localhost:3000 --cors http://127.0.0.1:3000",
  serveDebug:
    "opencode serve --port 4096 --hostname 127.0.0.1 --print-logs --log-level DEBUG",
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
- \`escribir_en_pizarra(agente, nota)\`: camina a la Sala de Reuniones y publica una nota técnica persistente en la **Pizarra de Arquitectura 3D** compartida.
- \`leer_pizarra(agente)\`: consulta desde cualquier punto de la oficina todas las notas y acuerdos técnicos vigentes (incluyendo decisiones publicadas por el usuario).
- \`pedir_revision_a(agente, destinatario, contexto, archivos, hilo)\`: camina al escritorio del compañero destinatario y despacha automáticamente el contexto y archivos a su sesión real de OpenCode (límite de seguridad de **2 rondas automáticas** por hilo; si se supera, detiene los rebotes y te avisa como alerta pendiente).

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

1. Inicia \`opencode serve\` dentro de la carpeta de tu proyecto (con logs detallados para ver herramientas y errores del proveedor en vivo; opcionalmente protegido con \`OPENCODE_SERVER_USERNAME\` y \`OPENCODE_SERVER_PASSWORD\`):
   \`\`\`bash
   ${OPENCODE_CLI_COMMANDS.serveDebug}
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
- **Un agente parece bloqueado o abre archivos de otra carpeta:** abre **Ajustes → Conexión → Diagnóstico en vivo** para confirmar que la carpeta del puente coincida con la que reporta OpenCode, revisar el estado del flujo SSE y consultar errores recientes del proveedor (como límites de uso gratuitos). Si una tarea falla por límite o desconexión, el agente se libera automáticamente y verás el botón **Reintentar** en su hilo.
- **Las herramientas MCP espaciales dicen puente sin conexión:** ejecuta \`npm run opencode:bridge\` desde la carpeta del proyecto para activar \`http://127.0.0.1:4097\`.
`;
}
