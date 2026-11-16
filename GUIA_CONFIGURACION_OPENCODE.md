# Reporte de Configuración: OpenCode CLI + Oficina Virtual 3D

Este documento reúne todo lo necesario para configurar los **5 agentes** en tu instalación local de **OpenCode** y conectarlos en tiempo real con la **Oficina Virtual 3D**.

---

## 1. Mapa de los 5 Agentes de la Oficina

| ID en OpenCode | Avatar en Oficina 3D | Especialidad | Modo sugerido | Alias reconocidos automáticamente |
| :--- | :--- | :--- | :--- | :--- |
| `architect` | Tech Lead | Architecture & Supervision | `primary` | architect, tech-lead, lead, orchestrator, plan, build, main |
| `frontend` | Frontend Dev | UI/UX & WebGL | `subagent` | frontend, frontend-dev, ui, ux, webgl, threejs |
| `qa` | DevOps / QA | Database & Reliability | `subagent` | qa, devops, reviewer, code-reviewer, test, audit |
| `backend` | Backend Dev | API & Business Logic | `subagent` | backend, backend-dev, api, server, db |
| `systems` | Systems Dev | CLI & Automation | `subagent` | systems, systems-dev, cli, automation, infra |

---

## 2. Dónde colocar `opencode.json`

1. **Por proyecto (recomendado):** guarda el archivo como `opencode.json` en la raíz del repositorio donde trabajas con OpenCode.
2. **Global:**
   - **macOS / Linux:** `~/.config/opencode/opencode.json`
   - **Windows (PowerShell):** `$env:USERPROFILE\.config\opencode\opencode.json`

Tienes la plantilla lista en el archivo `opencode.example.json` de este proyecto o descargable directamente desde el botón **OpenCode → Guía y Config** de la interfaz.

---

## 3. Comandos de arranque paso a paso

### Opción A — Conexión directa (`opencode serve`)

```bash
opencode serve --port 4096 --cors http://localhost:3000 --cors http://127.0.0.1:3000
```

Conecta tu terminal interactiva TUI al mismo servidor:

```bash
opencode attach http://127.0.0.1:4096
```

### Opción B — Con Puente Local Node (CORS + Basic Auth)

1. Arranca OpenCode en local:
   ```bash
   opencode serve --port 4096
   ```
2. Arranca el puente incluido en este repositorio:
   ```bash
   npm run opencode:bridge
   ```
3. Abre tu TUI con `opencode attach http://127.0.0.1:4096` y en la app web pulsa **OpenCode → Puente :4097 → Conectar**.
