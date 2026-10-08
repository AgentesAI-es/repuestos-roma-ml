import { getQuestion, listQuestions, type ListQuestionsParams } from '../ml-api';
import type { QuestionDetailResponse, QuestionsList } from '../types';
import { crearCache } from './cache';

/**
 * Lo que la bandeja le pide a ML, cacheado (ver `cache.ts`). Solo lo de ML:
 * el estado del agente sale siempre fresco de la base, así que aprobar o
 * editar se ve al instante aunque la lista venga del caché.
 *
 * El detalle de una pregunta (`/preguntas/[id]`) no pasa por acá: ahí se
 * quiere el estado de ML del momento.
 */

// Una página de preguntas: cambia cuando entra o se responde una en ML.
const listas = crearCache<QuestionsList>({ fresco: 30_000, maxViejo: 5 * 60_000, max: 200 });
// Texto y publicación de una pregunta, para las pestañas que salen de la tabla
// de revisión (una llamada por fila): casi no cambian.
const detalles = crearCache<QuestionDetailResponse>({ fresco: 5 * 60_000, maxViejo: 30 * 60_000, max: 1000 });

export function listQuestionsCacheada(params: ListQuestionsParams, opciones?: { forzar?: boolean }) {
  return listas.obtener(JSON.stringify(params), () => listQuestions(params), opciones);
}

export function getQuestionCacheada(id: string, connection: number, opciones?: { forzar?: boolean }) {
  return detalles.obtener(`${connection}:${id}`, () => getQuestion(id, connection), opciones);
}
