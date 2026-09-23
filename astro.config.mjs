// @ts-check
import { defineConfig, envField } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  session: false,
  // Detrás de Traefik (Dokploy) el Origin llega con el dominio público.
  security: { checkOrigin: true },
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

      // API de repuestos (respuestas del agente) — fase 2
      REPUESTOS_API_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      REPUESTOS_API_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Genera estados de agente simulados para previsualizar la UI mientras no exista la tabla
      AGENT_MOCK: envField.boolean({ context: 'server', access: 'secret', default: false }),

      // Protección básica del panel (recomendado en producción)
      DASHBOARD_USER: envField.string({ context: 'server', access: 'secret', optional: true }),
      DASHBOARD_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
