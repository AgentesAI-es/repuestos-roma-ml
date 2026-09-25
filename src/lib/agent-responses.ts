/**
 * Respuestas del agente (human in the loop), desde la API de repuestos.
 *
 *   GET   {REPUESTOS_API_URL}/v1/respuestas-agente?questionIds=1,2,3
 *   PATCH {REPUESTOS_API_URL}/v1/respuestas-agente/{id}   { revisadoPor, respuesta? }
 *
 * Autenticación con `x-api-key: REPUESTOS_API_TOKEN` (la API_KEY de esa API).
 * Se llama solo desde el servidor de Astro: la clave nunca llega al navegador.
 *
 * La tabla solo tiene lo que el agente mandó pidiendo revisión. Lo que
 * respondió sin revisión no está: mientras las respuestas sean notas privadas
 * (fase de desarrollo), esas preguntas se ven como "sin responder".
 *
 * Si REPUESTOS_API_URL no está configurada, no hay datos del agente; con
 * AGENT_MOCK=true se generan estados simulados para previsualizar la UI.
 */
import { AGENT_MOCK, REPUESTOS_API_URL, REPUESTOS_API_TOKEN } from 'astro:env/server';
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

export function agentSource(): 'repuestos' | 'mock' | 'none' {
  if (AGENT_MOCK) return 'mock';
  if (REPUESTOS_API_URL) return 'repuestos';
  return 'none';
}

export async function getAgentResponses(questionIds: number[]): Promise<AgentResponseMap> {
  if (questionIds.length === 0) return new Map();
  switch (agentSource()) {
    case 'mock':
      return mockResponses(questionIds);
    case 'repuestos':
      try {
        return await fetchFromRepuestos(questionIds);
      } catch (err) {
        // La vista de preguntas no debe caerse si la API de repuestos falla.
        console.error('[agent-responses]', err);
        return new Map();
      }
    default:
      return new Map();
  }
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (REPUESTOS_API_TOKEN) h['x-api-key'] = REPUESTOS_API_TOKEN;
  return h;
}

async function fetchFromRepuestos(questionIds: number[]): Promise<AgentResponseMap> {
  const url = new URL('/v1/respuestas-agente', REPUESTOS_API_URL);
  // La API acepta hasta 100 por llamada; una página del panel son 50.
  url.searchParams.set('questionIds', questionIds.slice(0, 100).join(','));

  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`API repuestos respondió ${res.status}`);
  const body = (await res.json()) as { respuestas?: unknown };
  if (!Array.isArray(body.respuestas)) throw new Error('API repuestos devolvió respuestas inválidas');

  // Vienen de la más nueva a la más vieja: la primera de cada pregunta es la vigente.
  const map: AgentResponseMap = new Map();
  for (const value of body.respuestas as AgentResponse[]) {
    const id = Number(value?.questionId);
    if (!Number.isSafeInteger(id) || map.has(id)) continue;
    map.set(id, value);
  }
  return map;
}

/**
 * Cuántas respuestas pendientes de revisión tiene una cuenta de ML. `null` si
 * no hay API de repuestos o falló (la UI muestra "—", no un cero falso).
 */
export async function countPending(connectionId: number): Promise<number | null> {
  if (agentSource() !== 'repuestos') return null;
  const url = new URL('/v1/respuestas-agente', REPUESTOS_API_URL);
  url.searchParams.set('status', 'pendiente');
  url.searchParams.set('meliConnectionId', String(connectionId));
  url.searchParams.set('limite', '1');
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`API repuestos respondió ${res.status}`);
  const { total } = (await res.json()) as { total?: unknown };
  return typeof total === 'number' ? total : null;
}

export class RevisionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Resuelve una respuesta pendiente. Sin `respuesta` (o con el mismo texto del
 * agente) la API la deja `aprobado`; con otro texto, `editado`, y deja una nota
 * privada en Chatwoot con la corrección. No publica nada en ML.
 */
export async function resolveRevision(id: string, revisadoPor: string, respuesta?: string) {
  if (!REPUESTOS_API_URL) throw new RevisionError('La API de repuestos no está configurada.', 500);
  const url = new URL(`/v1/respuestas-agente/${encodeURIComponent(id)}`, REPUESTOS_API_URL);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ revisadoPor, ...(respuesta !== undefined ? { respuesta } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new RevisionError(body?.error ?? `API repuestos respondió ${res.status}`, res.status);
  }
  return (await res.json()) as AgentResponse;
}

// --- Mock (solo para previsualizar) ---

function mockResponses(questionIds: number[]): AgentResponseMap {
  const muestras: (Pick<AgentResponse, 'status' | 'respuestaPropuesta' | 'respuestaEnviada'> | null)[] = [
    { status: 'pendiente', respuestaPropuesta: 'Hola, estamos verificando la compatibilidad con tu modelo exacto y te respondemos a la brevedad.', respuestaEnviada: null },
    { status: 'aprobado', respuestaPropuesta: '¡Hola! Sí, es compatible con tu vehículo. ¡Saludos!', respuestaEnviada: '¡Hola! Sí, es compatible con tu vehículo. ¡Saludos!' },
    { status: 'editado', respuestaPropuesta: 'Hola, no es compatible con ese modelo. ¡Saludos!', respuestaEnviada: 'Hola, para ese modelo va el código 01MI0043902. Indicanos el chasis y lo confirmamos. ¡Saludos!' },
    null,
  ];
  const map: AgentResponseMap = new Map();
  for (const id of questionIds) {
    const muestra = muestras[id % muestras.length];
    if (!muestra) continue;
    map.set(id, {
      id: `mock-${id}`,
      creadoEn: new Date().toISOString(),
      questionId: String(id),
      publicacionId: null,
      cuenta: null,
      revisadoPor: muestra.status === 'pendiente' ? null : 'mock',
      revisadoEn: muestra.status === 'pendiente' ? null : new Date().toISOString(),
      ...muestra,
    });
  }
  return map;
}
