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

      // API de repuestos (respuestas del agente) — fase 2
      REPUESTOS_API_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      REPUESTOS_API_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Genera estados de agente simulados para previsualizar la UI mientras no exista la tabla
      AGENT_MOCK: envField.boolean({ context: 'server', access: 'secret', default: false }),

      // Acceso embebido en Chatwoot (sección custom del sidebar)
      CHATWOOT_URL: envField.string({ context: 'server', access: 'secret', optional: true }),
      CHATWOOT_ACCOUNT_ID: envField.number({ context: 'server', access: 'secret', optional: true }),
      SESSION_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),

      // Protección básica del panel para acceso directo fuera de Chatwoot
      DASHBOARD_USER: envField.string({ context: 'server', access: 'secret', optional: true }),
      DASHBOARD_PASSWORD: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
