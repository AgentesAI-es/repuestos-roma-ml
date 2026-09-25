import type { APIRoute } from 'astro';
import { countPending } from '../../lib/agent-responses';
import { countQuestions } from '../../lib/ml-api';

/**
 * Conteos de una cuenta para el nav: los pide el navegador después de cargar
 * la página, así no frenan el render. Tres llamadas en paralelo:
 *
 *   sinResponder  total de ML con status UNANSWERED
 *   respondidas   total de ML con status ANSWERED
 *   pendientes    filas `pendiente` de esa cuenta en la API de repuestos
 *
 * Cada uno falla por separado (queda `null` y la UI muestra "—"). Se cachea
 * un minuto por cuenta: navegar entre páginas no vuelve a pegarle a ML.
 */
export interface Resumen {
  connection: number;
  sinResponder: number | null;
  pendientes: number | null;
  respondidas: number | null;
}

const TTL_MS = 60_000;
const cache = new Map<number, { at: number; value: Resumen }>();

export const GET: APIRoute = async ({ url }) => {
  const connection = Number(url.searchParams.get('connection'));
  if (!Number.isSafeInteger(connection) || connection <= 0) {
    return Response.json({ error: 'Falta connection' }, { status: 400 });
  }

  const hit = cache.get(connection);
  if (hit && Date.now() - hit.at < TTL_MS) return Response.json(hit.value);

  const [sinResponder, respondidas, pendientes] = await Promise.allSettled([
    countQuestions(connection, 'UNANSWERED'),
    countQuestions(connection, 'ANSWERED'),
    countPending(connection),
  ]);
  const valor = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
  for (const r of [sinResponder, respondidas, pendientes]) {
    if (r.status === 'rejected') console.error('[resumen]', connection, r.reason);
  }

  const value: Resumen = {
    connection,
    sinResponder: valor(sinResponder),
    respondidas: valor(respondidas),
    pendientes: valor(pendientes),
  };
  // No se cachea un resultado con fallas: que el próximo intento reintente.
  if (value.sinResponder !== null && value.respondidas !== null) cache.set(connection, { at: Date.now(), value });
  return Response.json(value);
};
