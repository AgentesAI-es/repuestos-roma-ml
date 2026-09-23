import { defineMiddleware } from 'astro:middleware';
import { DASHBOARD_USER, DASHBOARD_PASSWORD } from 'astro:env/server';

const PUBLIC_PATHS = ['/health'];

/** Basic Auth opcional: se activa sólo si DASHBOARD_USER y DASHBOARD_PASSWORD están definidos. */
export const onRequest = defineMiddleware((context, next) => {
  if (!DASHBOARD_USER || !DASHBOARD_PASSWORD) return next();
  if (PUBLIC_PATHS.includes(context.url.pathname)) return next();

  const header = context.request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    } catch {
      // base64 inválido → cae al 401
    }
    const sep = decoded.indexOf(':');
    if (sep > -1 && decoded.slice(0, sep) === DASHBOARD_USER && decoded.slice(sep + 1) === DASHBOARD_PASSWORD) {
      return next();
    }
  }

  return new Response('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Repuestos Roma - Preguntas ML", charset="UTF-8"' },
  });
});
