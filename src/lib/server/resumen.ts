import { countPending } from '../agent-responses';
import { countQuestions } from '../ml-api';

/**
 * Conteos de una cuenta para las cards del nav. Tres llamadas en paralelo:
 *
 *   sinResponder  total de ML con status UNANSWERED
 *   respondidas   total de ML con status ANSWERED
 *   pendientes    filas `pendiente` de esa cuenta en la tabla de revisión
 *
 * Cada uno falla por separado (queda `null` y la UI muestra "—").
 *
 * Caché en memoria por cuenta, stale-while-revalidate: el último valor bueno
 * no se borra nunca. El Layout lo pinta en el HTML (`ultimoResumen`, sin
 * esperar), así navegar entre pestañas o cuentas no vuelve a mostrar el
 * esqueleto; el navegador después lo pide a `/api/resumen` (`obtenerResumen`),
 * que solo le pega a ML si pasó el TTL.
 */
export interface Resumen {
  connection: number;
  sinResponder: number | null;
  pendientes: number | null;
  respondidas: number | null;
}

export const RESUMEN_TTL_MS = 60_000;
const cache = new Map<number, { at: number; value: Resumen }>();
// Un solo pedido a ML por cuenta a la vez: el refresco de varias pestañas abiertas no se multiplica.
const enCurso = new Map<number, Promise<Resumen>>();

/** El último resumen bueno de la cuenta, aunque esté vencido. `null` si nunca se cargó. */
export function ultimoResumen(connection: number): Resumen | null {
  return cache.get(connection)?.value ?? null;
}

/** Vence el resumen de la cuenta (sigue sirviendo para pintar): el próximo pedido va a ML. */
export function invalidarResumen(connection: number) {
  const hit = cache.get(connection);
  if (hit) hit.at = 0;
}

export async function obtenerResumen(connection: number): Promise<Resumen> {
  const hit = cache.get(connection);
  if (hit && Date.now() - hit.at < RESUMEN_TTL_MS) return hit.value;

  let pedido = enCurso.get(connection);
  if (!pedido) {
    pedido = cargar(connection).finally(() => enCurso.delete(connection));
    enCurso.set(connection, pedido);
  }
  return pedido;
}

async function cargar(connection: number): Promise<Resumen> {
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
  return value;
}
