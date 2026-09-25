# Repuestos Roma · Preguntas ML

Panel en Astro (SSR, Node) para ver las preguntas de clientes de Mercado Libre y el estado del agente que las responde.

- **Fase 1 (esto):** listado y detalle de preguntas desde la API de ML (`ml-repuestosroma.agentesai.es`), con el lugar reservado para el estado del agente.
- **Fase 2:** conectar la API de repuestos (tabla de respuestas / human in the loop) y habilitar aprobar/editar las respuestas que requieren revisión.

## Estados del agente

| Estado         | Significado                                            |
| -------------- | ------------------------------------------------------ |
| `revision`     | La respuesta requiere supervisión humana               |
| `sin_revision` | La respuesta no requiere supervisión humana            |
| `sin_evaluar`  | (sólo UI) no hay registro del agente para esa pregunta |

## Variables de entorno

Ver `.env.example`. Todas se leen **en runtime**: se cargan en el contenedor, no hace falta recompilar para cambiarlas.

| Variable              | Descripción                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `ML_API_URL`          | URL de la API de ML (por defecto la de producción)                 |
| `ML_API_TOKEN`        | `API_BEARER_TOKEN` de la API de ML (**obligatoria**)               |
| `ML_CONNECTION_ID`    | Cuenta ML por defecto si hay varias (opcional)                     |
| `REPUESTOS_API_URL`   | API de repuestos (`https://api-repuestosroma.agentesai.es`). Vacío = sin datos del agente |
| `REPUESTOS_API_TOKEN` | `API_KEY` de la API de repuestos (va en `x-api-key`)              |
| `AGENT_MOCK`          | `true` = estados simulados, para previsualizar la UI               |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | Basic Auth del panel. Vacías = panel sin protección |

El token de ML nunca llega al navegador: todas las llamadas se hacen desde el servidor.

## Desarrollo

```bash
cp .env.example .env   # completar ML_API_TOKEN
npm install
npm run dev            # http://localhost:4321
```

## Docker / Dokploy

1. En Dokploy crear un servicio **Docker Compose** apuntando a este repo (`docker-compose.yml`).
2. En **Environment** cargar las variables de `.env.example`, al menos `ML_API_TOKEN`, `ML_CONNECTION_ID` (el **id numérico** de la cuenta default, ej. `8`), `REPUESTOS_API_URL`, `REPUESTOS_API_TOKEN`, `DASHBOARD_USER` y `DASHBOARD_PASSWORD`.
3. En **Domains** asignar el dominio al servicio `web`, puerto `4321`, con HTTPS. **Tiene que ser un subdominio de `agentesai.es`**: es lo que `security.allowedDomains` de `astro.config.mjs` confía. Con otro dominio, Astro ignora los headers de Traefik y los forms (aprobar / editar) dan 403 "Cross-site POST form submissions are forbidden"; agregarlo ahí.
4. Deploy. Healthcheck: `GET /health`, que queda público aunque haya Basic Auth.

El servicio va en `dokploy-network` (externa), igual que la API de repuestos: es la red por la que Traefik lo alcanza.

Local:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

## API de repuestos (respuestas del agente)

`src/lib/agent-responses.ts` consulta, siempre desde el servidor:

```
GET   {REPUESTOS_API_URL}/v1/respuestas-agente?questionIds=123,456
PATCH {REPUESTOS_API_URL}/v1/respuestas-agente/{id}   { "revisadoPor": "...", "respuesta"?: "..." }
x-api-key: {REPUESTOS_API_TOKEN}
```

La tabla `respuesta_agente` solo tiene lo que el agente mandó **pidiendo revisión**, con `status` `pendiente` / `aprobado` / `editado`, la `respuestaPropuesta` del agente y la `respuestaEnviada` al final. El panel muestra tres estados por pregunta:

| Estado            | Criterio                                                         |
| ----------------- | ---------------------------------------------------------------- |
| Pendiente de revisión | fila con `status = pendiente`                                |
| Respondida        | fila `aprobado` o `editado`, o la pregunta está `ANSWERED` en ML |
| Sin responder     | el resto                                                         |

Mientras las respuestas del agente sean notas privadas en Chatwoot (fase de desarrollo), las que respondió **sin** pedir revisión no quedan en la tabla y ML las sigue viendo sin responder: el panel las muestra como "Sin responder".

En la bandeja, toda la card es el link al detalle: con un clic se abre en un modal sobre la lista (el mismo detalle con `?embed=1`, en un iframe; al cerrarlo, si se resolvió algo adentro, la lista se recarga). Ctrl+clic lo abre en otra pestaña. Las pendientes muestran la propuesta entera y un botón **Aprobar** que la aprueba tal cual y vuelve a la lista (`volver`, solo rutas del mismo sitio).

El detalle de la pregunta es una conversación: las preguntas anteriores del comprador en esa publicación (API de ML con `item_id` + `buyer_id`), la actual y sus respuestas, en una card del alto de la pantalla donde solo scrollea el chat. Si la respuesta del agente está pendiente, abajo hay un cuadro de respuesta cargado con la propuesta. Aprobar o editar (`POST /api/revision`) registra la decisión con el usuario del Basic Auth y **no publica nada en Mercado Libre**. Es un solo form que manda el texto del cuadro, y **la API decide el estado**: si no cambió, `aprobado`; si cambió, `editado`, y la API deja una nota privada en Chatwoot con la corrección (necesita `CHATWOOT_BOT_TOKEN` en la API). Si la API de repuestos falla, el panel sigue funcionando y muestra las preguntas sin datos del agente.

## Estructura

```
src/
  lib/ml-api.ts            cliente de la API de ML (server-side)
  lib/agent-responses.ts   proveedor de estados del agente (repuestos / mock / ninguno)
  lib/types.ts             tipos de ambas APIs
  middleware.ts            Basic Auth opcional
  components/PublicationPanel.astro   datos de la publicación (costado del detalle; franja en celular)
  pages/index.astro        listado: pestañas por estado (revisar / sin responder / respondidas / todas) + fechas y orden
  pages/preguntas/[id].astro  detalle: pregunta, respuesta del agente, publicación
  pages/health.ts          healthcheck
```
