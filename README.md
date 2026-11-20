# Oficina Virtual 3D para OpenCode

**Tu propio equipo de 5 especialistas de IA trabajando en tiempo real dentro de una oficina 3D sobre tus proyectos reales.**

Conecta tus agentes locales de [OpenCode](https://opencode.ai) y míralos habitar su oficina mientras leen tu código, editan archivos, buscan documentación en internet, anotan acuerdos en la pizarra y se piden revisiones entre ellos — todo reflejado en vivo y sin humo.

<p align="center">
  <img src="docs/images/office-3d-overview.jpg" alt="Vista general de la Oficina Virtual 3D para OpenCode" width="100%" />
</p>

<p align="center">
  <a href="#qué-es-esto">¿Qué es esto?</a> ·
  <a href="#por-qué-te-va-a-encantar">Lo más destacado</a> ·
  <a href="#recorrido-por-la-oficina-3d">La oficina 3D</a> ·
  <a href="#puesta-en-marcha-rápida-4-pasos">Puesta en marcha</a> ·
  <a href="#primeros-pasos-dentro-de-la-oficina">Primeros pasos</a> ·
  <a href="#solución-de-problemas">Solución de problemas</a>
</p>

---

## ¿Qué es esto?

En lugar de saltar entre cinco terminales distintas para saber qué está haciendo cada agente, **Oficina Virtual 3D** te da un espacio visual vivo para dirigir a tu equipo de desarrollo desde el navegador:

| Especialista | Rol en tu equipo | Dónde trabaja |
| :--- | :--- | :--- |
| **Tech Lead (`@architect`)** | Analiza tus requerimientos, organiza el plan y delega tareas al resto del equipo. | Despacho privado |
| **Frontend Dev (`@frontend`)** | Construye interfaces, estilos, componentes y lógica de cliente. | Isla de desarrollo |
| **Backend Dev (`@backend`)** | Diseña APIs, validaciones, modelos de datos y lógica de servidor. | Isla de desarrollo |
| **DevOps / QA (`@qa`)** | Revisa código, ejecuta pruebas, verifica compilaciones y valida calidad. | Isla de desarrollo |
| **Systems Dev (`@systems`)** | Crea scripts, automatizaciones, herramientas CLI e integraciones. | Isla de desarrollo |

Cada especialista tiene su propio escritorio con doble monitor, sabe en qué zona de la oficina está, qué compañeros tiene cerca y qué archivos reales está modificando en tu repositorio.

---

## Por qué te va a encantar

- **Cero humo en modo en vivo:** Al conectar OpenCode, las tareas de demostración desaparecen. Los monitores 3D y el **Inspector de Git** muestran únicamente tus archivos modificados reales (`git status`), diferencias línea por línea (`git diff`), historial reciente (`git log`) y la salida completa expandible de comandos o pruebas que hayan fallado — con botón para pedir revisión a QA o enviar el error a corregir en 1 clic.
- **Pizarra de Arquitectura compartida (fuera de Git):** Haz clic en la pizarra 3D de la sala de reuniones para escribir reglas o decisiones del proyecto. Los 5 agentes pueden consultarla y anotar nuevos acuerdos que se guardan automáticamente por proyecto en `~/.opencode-office-3d/`, sin ensuciar nunca tu `git status`.
- **Standups en 1 clic:** Pulsa sobre la mesa de la sala de reuniones para convocar al equipo, lanzar un objetivo o pedir estado actual con plantillas rápidas mientras los avatares disponibles caminan físicamente a la mesa.
- **Revisiones autónomas con freno de seguridad:** Cuando un especialista termina un cambio, puede caminar al escritorio de otro compañero y despacharle automáticamente una revisión real (`@qa`, `@backend`, etc.). Si tras **2 rondas automáticas** siguen sin resolver un bloqueo, el sistema frena los rebotes y te avisa como alerta pendiente para que tú decidas. Todo queda registrado en el hilo del revisor para auditarlo cuando quieras.
- **Búsqueda web gratuita integrada:** Con la configuración incluida de **Tavily**, los 5 agentes pueden consultar documentación oficial, versiones recientes de librerías y soluciones actualizadas en internet en tiempo real.
- **Pensada para tu segundo monitor:** Arranca en modo **solo avisos sutiles** (sin ruido de fondo intrusivo), muestra el contador de pendientes en el título de la pestaña y envía notificaciones de escritorio opcionales cuando un agente te hace una pregunta o solicita un permiso mientras sigues trabajando en tu editor.
- **Multi-proyecto y personalizable:** Cambia la carpeta del proyecto activo en segundos y personaliza nombres, roles o colores del equipo directamente desde **Ajustes**.

<p align="center">
  <img src="docs/images/office-3d-collaboration.jpg" alt="Ambiente nocturno y colaboración entre especialistas en la Oficina Virtual 3D" width="100%" />
</p>

---

## Recorrido por la oficina 3D

La oficina cuenta con **6 zonas interactivas** e **iluminación automática día/noche** que evoluciona a lo largo de tu jornada:

- **Despacho del Tech Lead:** Oficina acristalada para `@architect` con doble monitor y acceso directo a la sala de reuniones.
- **Sala de Reuniones:** Equipada con la **Mesa de Reuniones** (clic para abrir el Standup rápido) y la **Pizarra de Arquitectura 3D** (clic para ver, añadir o borrar acuerdos del proyecto).
- **Isla de Desarrollo:** 4 estaciones de trabajo con doble monitor vivo para `@frontend`, `@qa`, `@backend` y `@systems`.
- **Zona de Café, Lounge y Ping-Pong / Arcade:** Espacios donde los especialistas descansan de forma natural cuando no tienen tareas activas en cola.

### Qué ocurre al hacer clic en la escena 3D

| Elemento en 3D | Acción al hacer clic |
| :--- | :--- |
| **Cualquier especialista** | Enfoca la cámara sobre su estación y abre su hilo directo de conversación. |
| **Cualquier monitor 3D** | Abre el **Inspector flotante de Git y Actividad Técnica** filtrado en ese especialista. |
| **Mesa de la Sala de Reuniones** | Abre el diálogo de **Standup rápido** para enviar un mensaje o plantilla al equipo. |
| **Pizarra blanca 3D** | Abre la **Pizarra de Arquitectura** para leer o fijar reglas compartidas del proyecto. |

---

## Puesta en marcha rápida (4 pasos)

> **¿Solo quieres echar un vistazo primero?** Si ejecutas únicamente `npm install` y `npm run dev`, la oficina abrirá en **modo demostración** para que explores la escena 3D, las cámaras y los controles antes de conectar OpenCode.

### Paso 1 · Requisitos previos

Asegúrate de tener instalados en tu computadora:
- **[Node.js](https://nodejs.org/)** (versión 18 o superior)
- **[Git](https://git-scm.com/)** (para que el Inspector muestre cambios, diffs e historial)
- **[OpenCode CLI](https://opencode.ai)** instalado y funcionando en tu terminal (`opencode --version`)

### Paso 2 · Clonar e instalar dependencias

```bash
git clone <URL_DE_TU_REPOSITORIO>
cd oficina-virtual-3d
npm install
```

### Paso 3 · Configurar `opencode.json`

Copia el siguiente archivo como `opencode.json` en tu configuración global de OpenCode (recomendado para usarlo con todos tus proyectos) o en la raíz del proyecto donde quieras trabajar:

- **Windows:** `%USERPROFILE%\.config\opencode\opencode.json`
- **macOS / Linux:** `~/.config/opencode/opencode.json`

Antes de guardarlo, ajusta únicamente estos dos valores:
1. **`RUTA_ABSOLUTA_A_OFICINA`**: reemplázala por la ruta donde clonaste este repositorio (por ejemplo `C:/Users/TuUsuario/oficina-virtual-3d/mcp/office-spatial-server.js` en Windows —usa diagonales `/`— o `/Users/tuusuario/oficina-virtual-3d/mcp/office-spatial-server.js` en macOS/Linux). Si colocas `opencode.json` dentro de este mismo repo, basta con `"mcp/office-spatial-server.js"`.
2. **`tvly-TU_API_KEY_GRATUITA`** *(opcional pero muy recomendado)*: crea una cuenta gratuita en [tavily.com](https://tavily.com) para obtener tu API Key y darles acceso a internet en tiempo real. Si prefieres activar esto más tarde, cambia `"enabled": true` a `"enabled": false` en el bloque `"tavily"`.

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

Abre **3 terminales**: la primera dentro de la carpeta del proyecto donde vas a programar, y la segunda y tercera dentro de la carpeta de esta oficina.

**Terminal 1 — Servidor de OpenCode** *(dentro de la carpeta de tu proyecto)*:
```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

**Terminal 2 — Puente local de la oficina** *(dentro de `oficina-virtual-3d`)*:
```bash
npm run opencode:bridge
```

**Terminal 3 — Interfaz 3D** *(dentro de `oficina-virtual-3d`)*:
```bash
npm run dev
```

Listo. Abre **[http://localhost:3000](http://localhost:3000)** en tu navegador, haz clic en **OpenCode → Conectar** (modo *Puente local :4097*) y activa **Autoconectar al iniciar** si quieres entrar directo cada día.

---

## Primeros pasos dentro de la oficina

Apenas cargue la escena 3D y conectes OpenCode, prueba estas 4 acciones:

1. **Lanza un Standup en 1 clic:** Haz clic sobre la **mesa de la sala de reuniones**, elige una plantilla rápida (como *"Pedir estado actual al equipo"*) o escribe el objetivo del día. Verás a los especialistas disponibles acercarse a la sala mientras reciben el encargo real.
2. **Anota una regla en la Pizarra 3D:** Haz clic en la **pizarra blanca** de la sala de reuniones y escribe un acuerdo del proyecto (por ejemplo: *"Usar TypeScript estricto y responder siempre en español"*). Quedará visible en 3D y disponible al instante para los 5 agentes en sesiones futuras.
3. **Inspecciona código y consola desde cualquier escritorio:** Haz clic en el **monitor 3D** de cualquier especialista para abrir el Inspector flotante: revisa tus archivos modificados en Git, recorre los últimos commits (`git log`), expande la salida completa de cualquier prueba fallida o pulsa **Pedir revisión a QA** con un solo clic.
4. **Habla directo con un especialista:** Haz clic sobre cualquier avatar en 3D (o pulsa `Tab` / `H`) para abrir su hilo, delegarle una tarea concreta o responder a sus preguntas y solicitudes de permisos.

---

## Qué pueden hacer los agentes dentro de la oficina

Gracias al servidor MCP incluido (`office-spatial`) y a Tavily, los 5 agentes cuentan con estas herramientas:

| Herramienta | Qué hace |
| :--- | :--- |
| `observar_oficina` | Permite al agente saber en qué zona está, qué muebles tiene cerca y qué compañeros hay a su alrededor. |
| `moverse_a` | Camina físicamente por los pasillos hacia su escritorio, la sala de reuniones, la pizarra, el café, el lounge, el ping-pong o el escritorio de otro compañero. |
| `leer_pizarra` | Consulta todas las reglas y decisiones técnicas vigentes anotadas en la Pizarra de Arquitectura (incluyendo las que tú escribiste). |
| `escribir_en_pizarra` | Se acerca a la sala de reuniones y publica un nuevo acuerdo técnico en la pizarra compartida. |
| `pedir_revision_a` | Camina al escritorio de un compañero y despacha automáticamente el contexto y archivos a su sesión de OpenCode (con límite de seguridad de **2 rondas automáticas** por hilo antes de escalarte la alerta). |
| **Tavily MCP** | Busca documentación oficial, versiones actualizadas y soluciones en internet en tiempo real. |

---

## Cómo se conectan las piezas

```text
  [ Navegador · Oficina 3D ]  <──►  [ Puente Local (:4097) ]  <──►  [ OpenCode (:4096) ]
     http://localhost:3000           • Proxy SSE/API sin CORS         • 5 agentes reales
                                     • Git status / diff / log        • Herramientas MCP
                                     • Pizarra en ~/.opencode-office-3d/
```

- **Interfaz 3D (`:3000`):** Visualización Three.js, chat por especialista, Standup, Pizarra 3D e Inspector flotante.
- **Puente local (`:4097`):** Evita problemas de CORS en el navegador, lee el estado real de Git de tu carpeta activa, guarda la pizarra fuera de tu repo y coordina las revisiones automáticas entre sesiones.
- **OpenCode (`:4096`):** Ejecuta los modelos de IA, edita tus archivos, corre comandos y utiliza las herramientas MCP de la oficina y de Tavily.

---

## Controles, audio y atajos de teclado

| Control / Atajo | Acción |
| :--- | :--- |
| **Arrastrar / Rueda del mouse** | Orbitar, acercar y alejar la cámara por toda la oficina. |
| `Tab` o `H` | Abrir o cerrar el panel lateral de chat del equipo. |
| `Esc` | Cerrar el modal abierto o volver a la vista general de la oficina. |
| **Botón de Audio** *(esquina superior)* | Alterna entre **Solo avisos sutiles** (por defecto), **Ambiente + avisos** o **Silenciado**. |
| **Notificaciones de escritorio** *(Ajustes)* | Te avisa aunque tengas otra ventana activa si un agente pregunta algo o pide permiso. |
| **Cambiar de proyecto** *(Ajustes → Proyecto)* | Pega la ruta de otro repositorio y tanto el Inspector de Git como la Pizarra cambiarán automáticamente a ese proyecto. |

---

## Solución de problemas

- **OpenCode no lee `opencode.json` en Windows:** Comprueba que el archivo esté guardado en **UTF-8 sin BOM** y que la ruta hacia `office-spatial-server.js` use diagonales `/` (o doble barra invertida `\\`).
- **El botón *Conectar* marca error o no ve sesiones:** Verifica que las 3 terminales estén activas (`opencode serve` en `:4096`, `npm run opencode:bridge` en `:4097` y `npm run dev` en `:3000`) y selecciona el modo **Puente local (:4097)** dentro de **OpenCode → Ajustes**.
- **El Inspector de Git muestra otra carpeta:** Abre **Ajustes → Proyecto** y pega la ruta exacta del repositorio donde lanzaste `opencode serve`.
- **Un agente no puede buscar en internet:** Revisa que hayas pegado tu clave válida de [tavily.com](https://tavily.com) en `TAVILY_API_KEY` dentro de `opencode.json` y reinicia `opencode serve`.
- **¿Quieres más detalles técnicos de configuración?** Consulta también la guía complementaria [`GUIA_CONFIGURACION_OPENCODE.md`](GUIA_CONFIGURACION_OPENCODE.md).
