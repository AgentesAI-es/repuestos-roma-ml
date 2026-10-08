import type { APIRoute } from 'astro';
import { obtenerResumen } from '../../lib/server/resumen';

/**
 * Conteos de una cuenta para el nav (ver `lib/server/resumen.ts`). Los pide
 * el navegador después de cargar la página y cada minuto, así no frenan el
 * render. Cacheado un minuto por cuenta: navegar no vuelve a pegarle a ML.
 */
export type { Resumen } from '../../lib/server/resumen';

export const GET: APIRoute = async ({ url }) => {
  const connection = Number(url.searchParams.get('connection'));
  if (!Number.isSafeInteger(connection) || connection <= 0) {
    return Response.json({ error: 'Falta connection' }, { status: 400 });
  }
  return Response.json(await obtenerResumen(connection));
};
