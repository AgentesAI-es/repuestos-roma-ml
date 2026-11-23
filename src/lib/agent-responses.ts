/**
 * Respuestas del agente (human in the loop) para las vistas, desde la tabla
 * `respuesta_agente` de la base propia (`server/revision-db.ts`).
 *
 * La tabla solo tiene lo que el agente mandó pidiendo revisión. Lo que
 * respondió sin revisión no está: mientras las respuestas sean notas privadas
 * (fase de desarrollo), esas preguntas se ven como "sin responder".
 *
 * Sin DATABASE_URL no hay datos del agente: el panel muestra solo lo de ML.
 */
import { dbConfigurada } from './server/db';
import { getQuestionCacheada } from './server/ml-cache';
import { listarRespuestas, type FilaRevision } from './server/revision-db';
import type { AgentResponse, AgentStatus, Question } from './types';

/** La fila vigente de cada pregunta (la más reciente), por ID de pregunta. */
export type AgentResponseMap = Map<number, AgentResponse>;

export const AGENT_STATUSES: AgentStatus[] = ['pendiente', 'respondida', 'sin_responder'];

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; hint: string }> = {
  pendiente: { label: 'Pendiente de revisión', hint: 'El agente propuso una respuesta y espera una decisión' },
  respondida: { label: 'Respondida', hint: 'Respuesta aprobada o editada, o ya respondida en Mercado Libre' },
  sin_responder: { label: 'Sin responder', hint: 'Nadie la respondió todavía' },
};

export const REVISION_LABEL: Record<AgentResponse['status'], string> = {
  pendiente: 'pendiente de revisión',
  aprobado: 'aprobada',
  editado: 'editada',
};

export function isAgentStatus(value: string | null | undefined): value is AgentStatus {
  return !!value && (AGENT_STATUSES as string[]).includes(value);
}

/**
 * Respondida si ML ya la marca respondida (alguien contestó directo en ML: la
 * propuesta pendiente del agente ya no sirve) o si se aprobó o editó; pendiente
 * si la fila está pendiente; el resto, sin responder.
 */
export function agentStatusOf(map: AgentResponseMap, question: Pick<Question, 'id' | 'status'>): AgentStatus {
  const response = map.get(question.id);
  if (question.status === 'ANSWERED' || response?.status === 'aprobado' || response?.status === 'editado') return 'respondida';
  if (response?.status === 'pendiente') return 'pendiente';
  return 'sin_responder';
}

/** Milisegundos de una fecha ISO; NaN si no hay o no se entiende. */
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/**
 * Filtra por desde/hasta y ordena por `date_created`. Compara instantes y no
 * texto: ML manda las fechas con su offset (`-04:00`) y los filtros vienen en
 * UTC (`Z`), así que el orden de los strings no es el de las fechas. Las que no
 * tienen fecha van al final. `sinRespondidas` saca las que ML ya marca respondidas.
 */
export function ordenarParaRevisar<T extends Pick<Question, 'date_created' | 'status'>>(
  questions: T[],
  { sort, desde, hasta, sinRespondidas = false }: { sort: 'asc' | 'desc'; desde?: string; hasta?: string; sinRespondidas?: boolean },
): T[] {
  const min = ms(desde);
  const max = ms(hasta);
  return questions
    .filter((q) => !sinRespondidas || q.status !== 'ANSWERED')
    .filter((q) => {
      const t = ms(q.date_created);
      if (Number.isNaN(t)) return !desde && !hasta;
      return !(t < min) && !(t > max);
    })
    .sort((a, b) => {
      const ta = ms(a.date_created);
      const tb = ms(b.date_created);
      if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) ? (Number.isNaN(tb) ? 0 : 1) : -1;
      return (ta - tb) * (sort === 'asc' ? 1 : -1);
    });
}

export function agentSource(): 'db' | 'none' {
  return dbConfigurada() ? 'db' : 'none';
}

/** Las fechas, como texto: es lo que muestran las vistas. */
export const serializar = (f: FilaRevision): AgentResponse => ({
  id: f.id,
  creadoEn: f.creadoEn.toISOString(),
  questionId: f.questionId,
  publicacionId: f.publicacionId,
  meliConnectionId: f.meliConnectionId,
  respuestaPropuesta: f.respuestaPropuesta,
  respuestaEnviada: f.respuestaEnviada,
  status: f.status,
  revisadoPor: f.revisadoPor,
  revisadoEn: f.revisadoEn?.toISOString() ?? null,
});

export async function getAgentResponses(questionIds: number[]): Promise<AgentResponseMap> {
  if (questionIds.length === 0 || agentSource() === 'none') return new Map();
  try {
    const { filas } = await listarRespuestas({ questionIds: questionIds.map(String), limite: questionIds.length });
    // Una fila por pregunta (question_id es único).
    return new Map(filas.map((f) => [Number(f.questionId), serializar(f)]));
  } catch (err) {
    // La vista de preguntas no debe caerse si la base falla.
    console.error('[agent-responses]', err);
    return new Map();
  }
}

/**
 * Cuántas respuestas pendientes de revisión tiene una cuenta de ML, sin las que
 * ML ya marca respondidas (alguien contestó directo en ML: no hay nada que
 * revisar). Es lo que muestra "Para revisar", sin importar los filtros de fecha.
 * Mira el detalle de cada una en el caché de ML (el mismo que usa la pestaña);
 * si ML falla para una, se cuenta igual. `null` si no hay base (la UI muestra
 * "—", no un cero falso). Tira si la base falla.
 */
export async function countPending(connectionId: number, opciones?: { forzar?: boolean }): Promise<number | null> {
  if (agentSource() === 'none') return null;
  const filas = await listByStatus(connectionId, ['pendiente']);
  const estados = await Promise.allSettled(
    filas.map((f) => getQuestionCacheada(f.questionId!, connectionId, opciones)),
  );
  return estados.filter((e) => e.status === 'rejected' || e.value.question.status !== 'ANSWERED').length;
}

/**
 * Las filas de una cuenta con alguno de esos estados, una por pregunta. Es lo
 * que arma las pestañas "Para revisar" (`pendiente`) y "Aprobadas" (`aprobado`
 * y `editado`): salen de la tabla y no de una página de ML, así se ven todas
 * aunque ML las tenga en cualquier estado. Hasta 200 (cada una pide su detalle a ML).
 */
export async function listByStatus(connectionId: number, statuses: AgentResponse['status'][]): Promise<AgentResponse[]> {
  const { filas } = await listarRespuestas({ statuses, meliConnectionId: connectionId, limite: 200 });
  return filas.filter((f) => f.questionId).map(serializar);
}
