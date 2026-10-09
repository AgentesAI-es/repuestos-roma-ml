# HM-ML · Human in the loop para Mercado Libre

Panel en Astro (SSR, Node) para ver las preguntas de clientes de Mercado Libre y el estado del agente que las responde.

Es dueño de la revisión humana (human in the loop) de punta a punta:

- **La tool `enviar_respuesta`** (`POST /api/tool-execution`): el agente deja su respuesta en Chatwoot y, si pide revisión, queda en la cola.
- **La cola** (`respuesta_agente`, en su propio Postgres): las propuestas pendientes, aprobadas y editadas.
- **El panel**: listado y detalle de preguntas desde la API de ML, y aprobar/editar lo pendiente.

Una instalación por cliente (cada una con su Dokploy, su base y su `.env`).

## Flujo

De la pregunta en Mercado Libre a la respuesta revisada. El original editable está en [tldraw](https://www.tldraw.com/f/ldB10cpDMX09GRh4ADZGJ?d=v-423.207.2234.1262.flujo_documentado) (página "Flujo documentado"); si se cambia allá, actualizar también este diagrama.

```mermaid
flowchart TD
    pregunta["<b>MERCADO LIBRE</b><br/>1. El comprador pregunta en una publicación"]
    inbox["<b>CHATWOOT</b><br/>2. Entra a la inbox de ML como conversación<br/>(meli_item_id, buyer_id, question_id)"]
    bot["<b>CHATWOOT</b><br/>3. Bot de Chatwoot<br/>junta los datos de la pregunta y pide el contexto"]
    contexto["<b>API REPUESTOS ROMA</b><br/>4. GET /v1/publicaciones-ml/{id}/contexto"]
    nota_ctx>"<b>Qué trae el contexto</b><br/>• artículo del ERP: precio, stock, si está de baja<br/>• preguntas anteriores del comprador<br/>• ficha de ML (marca, nro. de pieza)<br/>• respuestas relacionadas<br/>Cada parte falla sola: siempre responde 200"]
    apiml["<b>API de ML</b><br/>historial del comprador · ficha de la publicación · respuestas a otros compradores"]
    jev["<b>OpenRouter · Jev</b><br/>elige las respuestas relacionadas que sirven (hasta 5)"]
    agente["<b>FRAMEWORK DE AGENTES</b><br/>5. Agente<br/>recibe contexto + pregunta del bot"]
    compat["<b>API REPUESTOS ROMA</b><br/>6. Tool consultar_compatibilidad (opcional)<br/>POST /v1/tool-execution"]
    autopartes["<b>API de autopartes</b><br/>veredicto: compatible · incompleto · incompatible"]
    enviar["<b>HM-ML</b><br/>7. Tool enviar_respuesta<br/>POST /api/tool-execution<br/>{ respuesta, revision }"]
    q_rev{"¿revision: true?"}
    q_pub{"¿ML_RESPUESTA_PUBLICA = true?"}
    publica["<b>CHATWOOT</b><br/>Mensaje público → ML lo publica<br/>⚠ no se puede deshacer"]
    privada_sin["<b>CHATWOOT</b><br/>Nota privada<br/>No entra a la cola: el panel la muestra 'Sin responder'"]
    pendiente["<b>HM-ML</b><br/>8. Fila en respuesta_agente (status = pendiente)<br/>+ nota privada en Chatwoot '⏳ Pendiente de revisión'"]
    panel["<b>HM-ML · PANEL</b><br/>9. Una persona revisa la propuesta<br/>(sección del sidebar de Chatwoot)"]
    q_cambio{"¿Cambió el texto?<br/>(lo decide el servidor)"}
    aprobado["<b>Aprobar</b><br/>status = aprobado"]
    editado["<b>Editar</b><br/>status = editado"]
    guardar["<b>HM-ML</b><br/>10. Guarda el texto final y quién revisó<br/>(solo si la fila sigue pendiente)"]
    nota_final["<b>CHATWOOT</b><br/>11. Nota privada con la respuesta final<br/>Si Chatwoot falla, la fila vuelve a pendiente"]
    postear["<b>MERCADO LIBRE</b><br/>Publicar la respuesta aprobada<br/>PENDIENTE · hoy aprobar no publica nada"]

    pregunta --> inbox
    inbox -- dispara --> bot
    bot -- pide / recibe contexto --> contexto
    contexto --> apiml
    apiml -- Respuestas --> jev
    jev --> contexto
    contexto -.- nota_ctx
    bot -- envía contexto + pregunta --> agente
    agente -- vehículo del comprador --> compat
    compat --> autopartes
    agente -- respuesta --> enviar
    enviar --> q_rev
    q_rev -- Sí --> pendiente
    q_rev -- No --> q_pub
    q_pub -- Sí --> publica
    q_pub -- No --> privada_sin
    pendiente --> panel
    panel --> q_cambio
    q_cambio -- No --> aprobado
    q_cambio -- Sí --> editado
    aprobado --> guardar
    editado --> guardar
    guardar --> nota_final
    nota_final -. a futuro .-> postear

    classDef ml fill:#fff3bf,stroke:#f08c00,color:#000
    classDef cw fill:#d0ebff,stroke:#1c7ed6,color:#000
    classDef fw fill:#e5dbff,stroke:#7048e8,color:#000
    classDef api fill:#d3f9d8,stroke:#2f9e44,color:#000
    classDef hm fill:#ffe8cc,stroke:#e8590c,color:#000
    classDef ext fill:#e9ecef,stroke:#868e96,color:#000
    class pregunta,postear ml
    class inbox,bot,publica,privada_sin,nota_final cw
    class agente fw
    class contexto,compat,nota_ctx api
    class enviar,q_rev,q_pub,pendiente,panel,q_cambio,aprobado,editado,guardar hm
    class apiml,jev,autopartes ext
```

Colores: 🟨 Mercado Libre · 🟦 Chatwoot · 🟪 Framework de agentes · 🟩 API Repuestos Roma · 🟧 HM-ML · ⬜ Servicios externos.

## Variables de entorno

Ver `.env.example`. Todas se leen **en runtime**: se cargan en el contenedor, no hace falta recompilar para cambiarlas.

| Variable              | Descripción                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `ML_API_URL`          | URL de la API de ML del cliente (**obligatoria**)                  |
| `ALLOWED_DOMAINS`     | Dominio del panel detrás de Traefik, o un comodín (`**.example.com`); varios separados por coma. **Se lee al compilar** (build arg): cambiarlo pide rebuild. Default del compose: `**.agentesai.es` |
| `ML_API_TOKEN`        | `API_BEARER_TOKEN` de la API de ML (**obligatoria**)               |
| `ML_CONNECTION_ID`    | Cuenta ML por defecto si hay varias (opcional)                     |
| `POSTGRES_PASSWORD`   | Contraseña de la base del compose (**obligatoria**; solo letras y números: va dentro de `DATABASE_URL`) |
| `POSTGRES_USER` / `POSTGRES_DB` | Opcionales (`hmml` / `hmml`)                             |
| `DATABASE_URL`        | La arma el compose con lo anterior. En `npm run dev`, cargarla a mano. Vacía = panel sin datos del agente |
| `TOOL_API_KEY`        | Key que manda el framework del agente a `/api/tool-execution` (`x-api-key` o `?apiKey=`). Vacía = tools deshabilitadas (503) |
| `CHATWOOT_URL`        | URL de Chatwoot: desde donde se embebe el panel y a donde van las respuestas y notas |
| `CHATWOOT_BOT_TOKEN`  | Token del bot de Chatwoot. La tool usa el `bot_key` del contexto si está vacío; aprobar/editar lo necesita |
| `CHATWOOT_TIMEOUT_MS` | Timeout de Chatwoot (default `8000`)                               |
| `ML_RESPUESTA_PUBLICA`| `true` = una respuesta sin revisión sale pública y se publica en ML. Default `false`: todo nota privada |
| `CHATWOOT_ACCOUNT_ID` | Cuenta de Chatwoot cuyos agentes pueden entrar (ej. `3`)           |
| `SESSION_SECRET`      | Firma de la cookie de sesión. Vacía = sesiones se pierden al reiniciar |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Basic Auth para acceso directo fuera de Chatwoot |

Sin `CHATWOOT_*` ni `DASHBOARD_*` el panel queda sin protección.

El token de ML nunca llega al navegador: todas las llamadas se hacen desde el servidor.

## Acceso desde Chatwoot

El panel se agrega como sección custom del sidebar de Chatwoot (Configuración → Custom sidebar sections, URL = dominio del panel). Al cargar el iframe:

1. Si no hay sesión, el panel muestra una página intermedia que le pide las credenciales a Chatwoot por `postMessage` (`CRM_AUTH_REQUEST` → `AUTH_TOKEN`), aceptando sólo mensajes con origen `CHATWOOT_URL`.
2. El servidor valida el `api_access_token` del agente contra `GET {CHATWOOT_URL}/api/v1/profile` y comprueba que pertenezca a `CHATWOOT_ACCOUNT_ID`. El token no se guarda.
3. Se crea una cookie firmada (`hmml_session`, 8 h, `SameSite=None; Partitioned`) y se recarga la página.

Abierto fuera de Chatwoot, redirige a `/login` (Basic Auth) si está configurado. El panel sólo se puede embeber desde `CHATWOOT_URL` (`frame-ancestors`).

## Desarrollo

```bash
cp .env.example .env   # completar ML_API_TOKEN (y DATABASE_URL para la cola)
npm install
npm run dev            # http://localhost:4321
npm test               # vitest; los de la base corren solo con TEST_DATABASE_URL
```

Los tests de `revision-db.int.test.ts` necesitan un Postgres descartable (borran filas):

```bash
docker run -d --rm --name hmml-test-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm test
```

## Docker / Dokploy

1. En Dokploy crear un servicio **Docker Compose** apuntando a este repo (`docker-compose.yml`).
2. En **Environment** cargar las variables de `.env.example`, al menos `ML_API_TOKEN`, `ML_CONNECTION_ID` (el **id numérico** de la cuenta default, ej. `8`), `POSTGRES_PASSWORD`, `TOOL_API_KEY`, `CHATWOOT_URL`, `CHATWOOT_BOT_TOKEN`, `DASHBOARD_USER` y `DASHBOARD_PASSWORD`.
3. En **Domains** asignar el dominio al servicio `web`, puerto `4321`, con HTTPS. **El dominio tiene que estar cubierto por `ALLOWED_DOMAINS`** (default `**.agentesai.es`). Si no, Astro ignora los headers de Traefik y los forms (aprobar / editar) dan 403 "Cross-site POST form submissions are forbidden".
4. Deploy. Healthcheck: `GET /health`, que queda público aunque haya Basic Auth. Con base, también la prueba (503 si no responde): así las migraciones se aplican al arrancar.

`web` va en `dokploy-network` (externa), que es la red por la que Traefik lo alcanza, y en `default` con `db`. La base no se publica: solo `web` la ve. Sus datos viven en el volumen `db-data`.

Local:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

## Tool `enviar_respuesta` (`POST /api/tool-execution`)

El framework del agente manda el sobre de siempre y se enruta por `tool`. Queda fuera del login del panel: se autentica con `TOOL_API_KEY`.

```
POST /api/tool-execution
x-api-key: {TOOL_API_KEY}

{ "tool": "enviar_respuesta",
  "payload": { "respuesta": "...", "revision": true },
  "context": { "cw_account_id": "3", "cw_conversation_id": "6459", "bot_key": "...",
               "question_id": "meli_q_13662962403", "meli_connection_id": "8", "meli_item_id": "MLA704095902" } }
```

- Deja el mensaje en la conversación de Chatwoot. **Sale como nota privada salvo que el agente no pida revisión Y `ML_RESPUESTA_PUBLICA=true`**: en el inbox de ML un mensaje público se publica en Mercado Libre y no se puede deshacer. `enviadoComo` le dice al agente a dónde fue.
- Con `revision: true` registra la propuesta en `respuesta_agente` (la nota lleva "⏳ Pendiente de revisión"; la tabla guarda el texto limpio). **Una fila por pregunta**: si el agente la vuelve a mandar pendiente, se pisa; si ya está resuelta, no se toca y se le avisa (`registro: "ya_resuelta"`). Es un solo `INSERT … ON CONFLICT … WHERE status = 'pendiente'`.
- Registra después de enviar y sin fallar si el registro falla: el mensaje ya salió, y un error haría que el agente reintente y lo duplique.
- Respuestas: 200 `{ ok, tool, resultado }`; 400 con `detalles` por campo (el agente se corrige); 401 key inválida; 503 sin `TOOL_API_KEY`; 502 si falla Chatwoot.

## La cola de revisión (`respuesta_agente`)

Postgres propio (`src/lib/server/db.ts`). Las migraciones están en ese archivo, se aplican solas en el primer uso y quedan anotadas en `_migraciones`; una nueva se agrega al final, nunca se edita una aplicada.

```
question_id        solo dígitos de context.question_id; ÚNICO
publicacion_id     context.meli_item_id (o publicacion_id)
meli_connection_id la cuenta de ML; el panel filtra y cuenta por ella
respuesta_propuesta  lo que propuso el agente; no se toca nunca
respuesta_enviada    null si pendiente; la propuesta si aprobado; el texto corregido si editado
status             pendiente -> aprobado | editado
cw_account_id / cw_conversation_id / cw_message_id   la nota del agente en Chatwoot
revisado_por / revisado_en / actualizado_en
```

La tabla solo tiene lo que el agente mandó **pidiendo revisión**. El panel muestra tres estados por pregunta:

| Estado            | Criterio                                                         |
| ----------------- | ---------------------------------------------------------------- |
| Pendiente de revisión | fila con `status = pendiente`                                |
| Respondida        | fila `aprobado` o `editado`, o la pregunta está `ANSWERED` en ML |
| Sin responder     | el resto                                                         |

La pestaña **Aprobadas** muestra solo las respuestas del agente que una persona aprobó o editó (filas `aprobado` / `editado`), sacadas de la tabla como "Para revisar". **Respondidas** incluye además las que se contestaron directo en ML.

Mientras las respuestas del agente sean notas privadas en Chatwoot (fase de desarrollo), las que respondió **sin** pedir revisión no quedan en la tabla y ML las sigue viendo sin responder: el panel las muestra como "Sin responder".

En la bandeja, toda la card es el link al detalle: con un clic se abre en un modal sobre la lista (el mismo detalle con `?embed=1`, en un iframe; al cerrarlo, si se resolvió algo adentro, la lista se recarga). Ctrl+clic lo abre en otra pestaña. Las pendientes muestran la propuesta entera y un botón **Aprobar** que la aprueba tal cual y vuelve a la lista (`volver`, solo rutas del mismo sitio).

El detalle de la pregunta es una conversación: las preguntas anteriores del comprador en esa publicación (API de ML con `item_id` + `buyer_id`), la actual y sus respuestas, en una card del alto de la pantalla donde solo scrollea el chat. Si la respuesta del agente está pendiente, abajo hay un cuadro de respuesta cargado con la propuesta. Aprobar o editar (`POST /api/revision`) registra la decisión con el nombre del agente de Chatwoot (o el usuario del Basic Auth si se entró directo) y **no publica nada en Mercado Libre**. Es un solo form que manda el texto del cuadro, y **el servidor decide el estado**: si no cambió, `aprobado`; si cambió, `editado`. En los dos casos deja una nota privada en Chatwoot con el texto final (necesita `CHATWOOT_BOT_TOKEN`). El orden importa: primero se toma la fila (UPDATE condicionado a `pendiente`, así dos personas a la vez no se pisan) y después va la nota; si Chatwoot falla, la fila vuelve a `pendiente`. Si la base falla, el panel sigue funcionando y muestra las preguntas sin datos del agente.

## Estructura

```
src/
  lib/ml-api.ts            cliente de la API de ML (server-side)
  lib/agent-responses.ts   estados del agente para las vistas (desde la base)
  lib/server/db.ts         Postgres + migraciones
  lib/server/revision.ts   reglas de la cola: registrar, decidir, resolver (+ revision-db.ts, las consultas)
  lib/server/chatwoot.ts   mensajes y notas en Chatwoot
  lib/server/tools/        tools del agente (enviar_respuesta)
  pages/api/tool-execution.ts  endpoint de las tools (TOOL_API_KEY)
  pages/api/revision.ts    aprobar / editar desde el detalle
  lib/types.ts             tipos de ambas APIs
  lib/auth.ts              sesión por Chatwoot + Basic Auth
  middleware.ts            control de acceso
  pages/auth/chatwoot.ts   valida el token de Chatwoot y crea la sesión
  pages/login.ts           acceso directo con Basic Auth
  components/PublicationPanel.astro   datos de la publicación (costado del detalle; franja en celular)
  pages/index.astro        listado: pestañas por estado (revisar / sin responder / respondidas / todas) + fechas y orden
  pages/preguntas/[id].astro  detalle: pregunta, respuesta del agente, publicación
  pages/health.ts          healthcheck
```
