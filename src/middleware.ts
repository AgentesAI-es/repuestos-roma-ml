import type { APIContext, MiddlewareNext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import {
  SESSION_COOKIE,
  basicAuthChallenge,
  basicAuthEnabled,
  chatwootOrigin,
  checkBasicAuth,
  embedAuthPage,
  readSession,
} from './lib/auth';

const PUBLIC_PATHS = ['/health', '/auth/chatwoot', '/login'];

/**
 * Acceso al panel:
 * - Embebido en Chatwoot (CHATWOOT_URL + CHATWOOT_ACCOUNT_ID): sesión por cookie validada con el token del agente.
 * - Basic Auth (DASHBOARD_USER + DASHBOARD_PASSWORD): acceso directo fuera de Chatwoot.
 * Sin ninguno de los dos configurado, el panel queda abierto.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await guard(context, next);
  if (chatwootOrigin) {
    try {
      response.headers.set('Content-Security-Policy', `frame-ancestors 'self' ${chatwootOrigin}`);
    } catch {
      // Respuestas con headers inmutables (ej. Response.redirect)
    }
  }
  return response;
});

const guard = async (context: APIContext, next: MiddlewareNext): Promise<Response> => {
  if (!chatwootOrigin && !basicAuthEnabled) return next();
  if (PUBLIC_PATHS.includes(context.url.pathname)) return next();
  if (await readSession(context.cookies.get(SESSION_COOKIE)?.value)) return next();
  if (checkBasicAuth(context.request.headers.get('authorization'))) return next();

  if (chatwootOrigin && context.request.method === 'GET') return embedAuthPage();
  if (basicAuthEnabled) return basicAuthChallenge();
  return new Response('Autenticación requerida', { status: 401 });
};
