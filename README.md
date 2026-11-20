# Oficina Virtual 3D para OpenCode

**Tu propio equipo de 5 especialistas de IA trabajando en tiempo real dentro de una oficina 3D sobre tus proyectos reales.**

Conecta tus agentes locales de [OpenCode](https://opencode.ai) y míralos habitar su oficina mientras leen tu código, editan archivos, buscan documentación en internet, anotan acuerdos en la pizarra y se piden revisiones entre ellos — todo reflejado en vivo y sin humo.

---

## ¿Qué es esto?

En lugar de saltar entre cinco terminales distintas para saber qué está haciendo cada agente, **Oficina Virtual 3D** te da un espacio visual vivo para dirigir a tu equipo de desarrollo:

| Especialista | Rol en tu equipo |
| :--- | :--- |
| **Tech Lead (`@architect`)** | Analiza tus requerimientos, organiza el plan y delega tareas al resto del equipo. |
| **Frontend Dev (`@frontend`)** | Construye interfaces, estilos, componentes y lógica de cliente. |
| **Backend Dev (`@backend`)** | Diseña APIs, validaciones, modelos de datos y lógica de servidor. |
| **DevOps / QA (`@qa`)** | Revisa código, ejecuta pruebas, verifica compilaciones y valida calidad. |
| **Systems Dev (`@systems`)** | Crea scripts, automatizaciones, herramientas CLI e integraciones. |

Cada especialista tiene su propio escritorio, conoce dónde está parado en la oficina, qué compañeros tiene cerca y qué archivos está tocando en tu repositorio real.

---

## Por qué te va a encantar

- **Cero humo en modo en vivo:** Al conectar OpenCode, las tareas de demostración desaparecen. Los monitores 3D y el **Inspector de Git** muestran únicamente tus archivos modificados reales (`git status`), diferencias línea por línea (`git diff`), historial reciente (`git log`) y la salida completa de comandos o pruebas que hayan fallado.
- **Pizarra de Arquitectura compartida:** Haz clic en la pizarra 3D de la sala de reuniones para escribir reglas o decisiones del proyecto. Los 5 agentes pueden leerla y anotar nuevos acuerdos que se guardan automáticamente fuera de tu repositorio (`~/.opencode-office-3d/`), sin ensuciar nunca tu `git status`.
- **Standups en 1 clic:** Pulsa sobre la mesa de la sala de reuniones para convocar al equipo, lanzar un objetivo o pedir estado actual mientras los avatares disponibles se acercan físicamente a la mesa.
- **Revisiones autónomas con freno de seguridad:** Cuando un especialista termina un cambio, puede caminar al escritorio de otro compañero y despacharle automáticamente una revisión real (`@qa`, `@backend`, etc.). Si tras **2 rondas automáticas** siguen sin resolver un bloqueo, el sistema frena los rebotes y te avisa como alerta pendiente para que tú decidas. Todo queda registrado en el hilo del revisor para auditarlo cuando quieras.
- **Pensada para tu segundo monitor:** Arranca con **solo avisos sutiles** (sin ruido de fondo intrusivo), muestra el conteo de pendientes en el título de la pestaña y envía notificaciones de escritorio opcionales cuando alguien te hace una pregunta o necesita un permiso mientras estás en tu editor.
- **Búsqueda web gratuita integrada:** Con la configuración incluida de **Tavily**, los 5 agentes pueden consultar documentación oficial, versiones recientes de librerías y soluciones actualizadas en internet.
- **Usa la misma oficina con cualquier proyecto:** Cambia la carpeta del proyecto activo y personaliza nombres, roles o colores del equipo directamente desde **Ajustes**.

---

## Puesta en marcha rápida (4 pasos)

> **¿Solo quieres echar un vistazo primero?** Si ejecutas únicamente `npm install` y `npm run dev`, la oficina abrirá en **modo demostración** para que explores la escena 3D antes de conectar OpenCode.

### Paso 1 · Requisitos previos

Asegúrate de tener instalados en tu computadora:
- **[Node.js](https://nodejs.org/)** (versión 18 o superior)
- **[OpenCode CLI](https://opencode.ai)** instalado y funcionando en tu terminal (`opencode --version`)

### Paso 2 · Clonar e instalar dependencias

```bash
git clone <URL_DE_TU_REPOSITORIO>
cd oficina-virtual-3d
npm install
```

### Paso 3 · Configurar `opencode.json`

Copia el siguiente archivo como `opencode.json` en tu configuración global de OpenCode (para usarlo en todos tus proyectos) o en la raíz del proyecto donde quieras trabajar:

- **Windows:** `%USERPROFILE%\.config\opencode\opencode.json`
- **macOS / Linux:** `~/.config/opencode/opencode.json`

Antes de guardarlo, ajusta estos dos valores:
1. **`RUTA_ABSOLUTA_A_OFICINA`**: reemplázala por la ruta donde clonaste este repositorio (por ejemplo `C:/Users/TuUsuario/oficina-virtual-3d/mcp/office-spatial-server.js` en Windows o `/Users/tuusuario/oficina-virtual-3d/mcp/office-spatial-server.js` en macOS/Linux). Si pones `opencode.json` dentro de este mismo repo, basta con `"mcp/office-spatial-server.js"`.
2. **`tvly-TU_API_KEY_GRATUITA`** *(opcional pero muy recomendado)*: crea una cuenta gratuita en [tavily.com](https://tavily.com) para obtener tu API Key y darles acceso a internet en tiempo real. Si prefieres no usar búsqueda web aún, cambia `"enabled": true` a `"enabled": false` en el bloque `"tavily"`.

```json
{
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
      "command": ["node", "RUTA_ABSOLUTA_A_OFICINA/mcp/office-spatial-server.js"],
      "environment": {
        "OFFICE_BRIDGE_URL": "http://127.0.0.1:4097"
      },
      "enabled": true
    },
    "tavily": {
      "type": "local",
      "command": ["npx", "-y", "tavily-mcp@latest"],
      "environment": {
        "TAVILY_API_KEY": "tvly-TU_API_KEY_GRATUITA"
      },
      "enabled": true
    }
  },
  "agent": {
    "architect": {
      "description": "Tech Lead que coordina arquitectura y delega tareas.",
      "mode": "primary",
      "prompt": "Eres Tech Lead (architect). Analiza el problema y delega de forma autónoma en @frontend, @backend, @qa o @systems usando la herramienta task. Si hay decisiones de negocio o arquitectura ambiguas, pregunta primero al usuario. Habitas una oficina 3D compartida y dispones de observar_oficina, moverse_a, escribir_en_pizarra, leer_pizarra, pedir_revision_a y búsqueda web con Tavily: consulta leer_pizarra al iniciar, registra acuerdos clave en escribir_en_pizarra y coordina revisiones autónomas con pedir_revision_a (máximo 2 rondas automáticas por hilo antes de escalar al usuario)."
    },
    "frontend": {
      "description": "UI/UX, componentes web y escenas interactivas.",
      "mode": "all",
      "prompt": "Eres Frontend Dev (@frontend). Implementas vistas, estilos y componentes con autonomía. Consulta documentación actualizada con Tavily si la necesitas. Dispones de observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a: lee la pizarra al iniciar y, al terminar cambios relevantes, despacha revisión autónoma a @qa o @backend (máximo 2 rondas por hilo)."
    },
    "backend": {
      "description": "APIs, persistencia y lógica de negocio.",
      "mode": "all",
      "prompt": "Eres Backend Dev (@backend). Diseñas rutas, validaciones y servicios con autonomía. Usa Tavily para verificar documentación técnica actualizada. Dispones de observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a para documentar contratos y despachar revisiones automáticas a @frontend o @qa (máximo 2 rondas por hilo)."
    },
    "qa": {
      "description": "Pruebas automatizadas, auditoría y revisión de código.",
      "mode": "all",
      "prompt": "Eres DevOps / QA (@qa). Verificas pruebas, compilación y calidad con autonomía. Puedes usar Tavily, observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a para revisar cambios o devolver correcciones automáticas al autor (respetando el límite de 2 rondas por hilo; si persiste un bloqueo, detente y escala al usuario)."
    },
    "systems": {
      "description": "CLI, scripts, automatización e infraestructura.",
      "mode": "all",
      "prompt": "Eres Systems Dev (@systems). Construyes scripts CLI, automatizaciones e integraciones con autonomía. Puedes usar Tavily, observar_oficina, moverse_a, leer_pizarra, escribir_en_pizarra y pedir_revision_a para consultar acuerdos vigentes o despachar revisiones automáticas a @qa o @backend (máximo 2 rondas por hilo)."
    }
  }
}
```

> **Importante (especialmente en Windows):** Guarda `opencode.json` con codificación **UTF-8 sin BOM**. Algunos editores o PowerShell agregan BOM por defecto y pueden hacer que OpenCode no lea el JSON correctamente.

### Paso 4 · Arrancar los 3 servicios

Abre **3 terminales** (en la primera sitúate en la carpeta del proyecto donde vas a programar; en la segunda y tercera, dentro de la carpeta de esta oficina):

**Terminal 1 — Servidor de OpenCode** *(ejecútalo dentro de la carpeta de tu proyecto)*:
```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

**Terminal 2 — Puente local de la oficina** *(en la carpeta de `oficina-virtual-3d`)*:
```bash
npm run opencode:bridge
```

**Terminal 3 — Interfaz 3D** *(en la carpeta de `oficina-virtual-3d`)*:
```bash
npm run dev
```

Listo. Abre **[http://localhost:3000](http://localhost:3000)** en tu navegador, haz clic en **OpenCode → Conectar** (modo *Puente local :4097*) y activa **Autoconectar al iniciar** si quieres entrar directo cada día.

---

## Primeros pasos dentro de la oficina

Apenas cargue la escena 3D y conectes OpenCode, prueba estas 3 cosas:

1. **Lanza un Standup en 1 clic:** Haz clic sobre la **mesa de la sala de reuniones** en 3D, elige una plantilla rápida (como *"Pedir estado actual al equipo"*) o escribe el objetivo del día. Verás al equipo acercarse a la sala mientras reciben el encargo real.
2. **Anota una regla en la Pizarra 3D:** Haz clic en la **pizarra blanca** de la sala de reuniones y escribe un acuerdo del proyecto (por ejemplo: *"Usar TypeScript estricto y responder siempre en español"*). Quedará visible en 3D y disponible al instante para los 5 agentes en sesiones futuras.
3. **Inspecciona código y consola desde cualquier escritorio:** Haz clic en el **monitor 3D** de cualquier especialista para abrir el Inspector flotante: revisa tus archivos modificados en Git, recorre los últimos commits, expande la salida completa de cualquier prueba fallida o pulsa **Pedir revisión a QA** sobre un archivo con un solo clic.

---

## Consejos rápidos

- **Trabajar en otro repositorio:** Abre **Ajustes → Proyecto** y pega la ruta de la carpeta del proyecto que quieras supervisar; tanto el Inspector de Git como las notas de la pizarra cambiarán automáticamente a ese proyecto.
- **Control de audio:** Usa el botón de sonido de la esquina superior para alternar entre **Solo avisos sutiles** (por defecto), **Ambiente + avisos** o **Silenciado**.
- **Atajos de teclado:** Pulsa `Tab` o `H` para abrir/cerrar el chat lateral y `Esc` para cerrar cualquier modal o volver a la vista general.
