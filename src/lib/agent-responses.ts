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
 * Pendiente si la fila está pendiente; respondida si se aprobó o editó, o si ML ya la
 * marca respondida (alguien contestó directo en ML); el resto, sin responder.
 */
export function agentStatusOf(map: AgentResponseMap, question: Pick<Question, 'id' | 'status'>): AgentStatus {
  const response = map.get(question.id);
  if (response?.status === 'pendiente') return 'pendiente';
  if (response?.status === 'aprobado' || response?.status === 'editado' || question.status === 'ANSWERED') return 'respondida';
  return 'sin_responder';
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
 * Cuántas respuestas pendientes de revisión tiene una cuenta de ML. `null` si
 * no hay base (la UI muestra "—", no un cero falso). Tira si la base falla.
 */
export async function countPending(connectionId: number): Promise<number | null> {
  if (agentSource() === 'none') return null;
  const { total } = await listarRespuestas({ statuses: ['pendiente'], meliConnectionId: connectionId, limite: 0 });
  return total;
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
