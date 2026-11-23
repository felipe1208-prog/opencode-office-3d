# Reporte de Configuración: OpenCode CLI + Oficina Virtual 3D

Este documento reúne todo lo necesario para configurar los **5 agentes** en tu instalación local de **OpenCode** y conectarlos en tiempo real con la **Oficina Virtual 3D**.

---

## 1. Mapa de los 5 Agentes de la Oficina

| ID en OpenCode | Avatar en Oficina 3D | Especialidad | Modo sugerido | Alias reconocidos automáticamente |
| :--- | :--- | :--- | :--- | :--- |
| `architect` | Tech Lead | Architecture & Supervision | `primary` | architect, tech-lead, lead, orchestrator, plan, build, main |
| `frontend` | Frontend Dev | UI/UX & WebGL | `all` | frontend, frontend-dev, ui, ux, webgl, threejs |
| `qa` | DevOps / QA | Database & Reliability | `all` | qa, devops, reviewer, code-reviewer, test, audit |
| `backend` | Backend Dev | API & Business Logic | `all` | backend, backend-dev, api, server, db |
| `systems` | Systems Dev | CLI & Automation | `all` | systems, systems-dev, cli, automation, infra |

---

## 2. Dónde colocar `opencode.json`

1. **Por proyecto (recomendado):** guarda el archivo como `opencode.json` en la raíz del repositorio donde trabajas con OpenCode.
2. **Global:**
   - **macOS / Linux:** `~/.config/opencode/opencode.json`
   - **Windows (PowerShell):** `$env:USERPROFILE\.config\opencode\opencode.json`

Tienes la plantilla lista (incluyendo el servidor MCP `"office-spatial"`) en el archivo `opencode.example.json` de este proyecto o descargable directamente desde el botón **OpenCode → Guía y Config** de la interfaz.

---

## 3. Conciencia Espacial 3D (`mcp/office-spatial-server.js`)

Al incluir la sección `"mcp.office-spatial"` en `opencode.json` y tener corriendo `npm run opencode:bridge`, los 5 agentes ganan percepción espacial real de la oficina 3D mediante 3 herramientas:

- `observar_oficina(agente)`: consulta su zona actual, coordenadas `(x, z)`, postura, objetos a menos de 2.5m, compañeros cercanos y notas de la pizarra.
- `moverse_a(agente, destino, motivo)`: desplaza al agente hacia `escritorio`, `pizarra`, `sala_reuniones`, `cafe`, `lounge`, `ping_pong`, `arcade` o junto a un compañero (`frontend`, `backend`, `qa`, `systems`, `architect`).
- `escribir_en_pizarra(agente, nota)`: camina a la Sala de Reuniones y publica una nota de arquitectura en la pizarra 3D compartida.

---

## 4. Comandos de arranque paso a paso

### Opción A — Conexión directa (`opencode serve`)

```bash
opencode serve --port 4096 --cors http://localhost:3000 --cors http://127.0.0.1:3000
```

Conecta tu terminal interactiva TUI al mismo servidor:

```bash
opencode attach http://127.0.0.1:4096
```

*(Si quieres habilitar las herramientas MCP espaciales en paralelo, ejecuta también `npm run opencode:bridge`).*

### Opción B — Con Puente Local Node (CORS + Basic Auth + MCP Espacial)

1. Arranca OpenCode en local dentro de la carpeta de tu proyecto:
   ```bash
   opencode serve --port 4096 --hostname 127.0.0.1 --print-logs --log-level DEBUG
   ```
2. Arranca el puente incluido en este repositorio:
   ```bash
   npm run opencode:bridge
   ```
3. Abre tu TUI con `opencode attach http://127.0.0.1:4096` y en la app web pulsa **OpenCode → Puente :4097 → Conectar**.
