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
| `REPUESTOS_API_URL`   | API de repuestos (fase 2). Vacío = estados "Sin evaluar"           |
| `REPUESTOS_API_TOKEN` | Bearer de la API de repuestos (fase 2)                             |
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
2. En **Environment** cargar las variables de `.env.example`, al menos `ML_API_TOKEN`, `DASHBOARD_USER` y `DASHBOARD_PASSWORD`.
3. En **Domains** asignar el dominio al servicio `web`, puerto `4321`.
4. Deploy. Healthcheck: `GET /health`, que queda público aunque haya Basic Auth.

Local:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
```

## Contrato propuesto para la fase 2 (API de repuestos)

`src/lib/agent-responses.ts` consulta:

```
GET {REPUESTOS_API_URL}/agent-responses?question_ids=123,456
Authorization: Bearer {REPUESTOS_API_TOKEN}

200 → {
  "responses": [
    {
      "question_id": 123,
      "revision": true,
      "respuesta": "Mensaje de respuesta al cliente"
    }
  ]
}
```

`revision` y `respuesta` son los dos campos de la tool del agente. `question_id` es un identificador que la API debe añadir a cada registro para relacionarlo con una pregunta. Este endpoint sigue siendo un contrato propuesto: si la API expone otra forma, hay que adaptar `fetchFromRepuestos` en ese archivo. Si la API de repuestos falla, el panel sigue funcionando y muestra las preguntas como "Sin evaluar".

## Estructura

```
src/
  lib/ml-api.ts            cliente de la API de ML (server-side)
  lib/agent-responses.ts   proveedor de estados del agente (repuestos / mock / ninguno)
  lib/types.ts             tipos de ambas APIs
  middleware.ts            Basic Auth opcional
  pages/index.astro        listado + filtros + resumen por estado
  pages/preguntas/[id].astro  detalle: pregunta, respuesta del agente, publicación
  pages/health.ts          healthcheck
```
