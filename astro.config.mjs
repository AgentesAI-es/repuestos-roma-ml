// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: { plugins: [tailwindcss()] },
  session: false,
  security: {
    checkOrigin: true,
    // Detrás de Traefik (Dokploy) el request llega por http interno. Astro 7
    // ignora Host y X-Forwarded-* salvo para estos dominios: sin esto la app
    // cree estar en http://localhost:4321, el Origin del navegador
    // (https://<dominio>) no coincide y checkOrigin rechaza con 403 los forms
    // (aprobar / editar). Verificado simulando los headers de Traefik.
    allowedDomains: [{ hostname: '**.agentesai.es', protocol: 'https' }],
  },
  env: {
    schema: {
      // Todas 'secret': se leen en runtime (variables del contenedor), no se hornean en el build.
      // API de Mercado Libre (preguntas)
      ML_API_URL: envField.string({
        context: 'server',
        access: 'secret',
        default: 'https://ml-repuestosroma.agentesai.es',
      }),
      ML_API_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      ML_CONNECTION_ID: envField.string({ context: 'server', access: 'secret', optional: true }),

      // Postgres propio: la tabla respuesta_agente (cola de revisión). Las
      // migraciones se aplican solas al primer uso. Vacío = panel sin datos del agente.
      DATABASE_URL: envField.string({ context: 'server', access: 'secret', optional: true }),

      // Tools del agente (POST /api/tool-execution): la key que manda el framework
      // en `x-api-key` (o `?apiKey=`). Vacía = endpoint deshabilitado (503).
      TOOL_API_KEY: envField.string({ context: 'server', access: 'secret', optional: true }),

      // Chatwoot: acceso embebido (sección custom del sidebar) y destino de las
      // respuestas del agente y de las notas de revisión.
      CHATWOOT_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      CHATWOOT_ACCOUNT_ID: envField.number({ context: 'server', access: 'secret', optional: true }),
      SESSION_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Token del bot. Si está vacío, enviar_respuesta usa el `context.bot_key` del
      // framework; aprobar/editar desde el panel lo necesita (ahí no hay bot_key).
      CHATWOOT_BOT_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      CHATWOOT_TIMEOUT_MS: envField.number({ context: 'server', access: 'secret', default: 8000 }),
      // Un mensaje público en el inbox de ML se publica como respuesta en Mercado
      // Libre y no se puede deshacer. Apagado, todo sale como nota privada.
      ML_RESPUESTA_PUBLICA: envField.boolean({ context: 'server', access: 'secret', default: false }),

      // Protección básica del panel para acceso directo fuera de Chatwoot
      DASHBOARD_USER: envField.string({ context: 'server', access: 'secret', optional: true }),
      DASHBOARD_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
