/**
 * Proveedor de respuestas del agente (human in the loop).
 *
 * Fase 1: la tabla aún no existe en la API de repuestos, así que:
 *   - si REPUESTOS_API_URL no está configurada → todas las preguntas quedan "sin_evaluar"
 *   - si AGENT_MOCK=true → se generan estados simulados (determinísticos) para previsualizar la UI
 *
 * Fase 2: ajustar `fetchFromRepuestos` al endpoint real. Contrato propuesto:
 *   GET {REPUESTOS_API_URL}/agent-responses?question_ids=1,2,3
 *   → { "responses": AgentResponse[] }
 */
import { AGENT_MOCK, REPUESTOS_API_URL, REPUESTOS_API_TOKEN } from 'astro:env/server';
import type { AgentResponse, AgentStatus } from './types';

export type AgentResponseMap = Map<number, AgentResponse>;

export const AGENT_STATUSES: AgentStatus[] = ['revision', 'sin_revision', 'sin_evaluar'];

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; hint: string }> = {
  revision: { label: 'Requiere revisión', hint: 'La respuesta necesita supervisión humana' },
  sin_revision: { label: 'Sin revisión', hint: 'La respuesta no necesita supervisión humana' },
  sin_evaluar: { label: 'Sin evaluar', hint: 'El agente todavía no procesó esta pregunta' },
};

export function isAgentStatus(value: string | null | undefined): value is AgentStatus {
  return !!value && (AGENT_STATUSES as string[]).includes(value);
}

export function agentStatusOf(map: AgentResponseMap, questionId: number): AgentStatus {
  const response = map.get(questionId);
  return response ? (response.revision ? 'revision' : 'sin_revision') : 'sin_evaluar';
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

async function fetchFromRepuestos(questionIds: number[]): Promise<AgentResponseMap> {
  const url = new URL('/agent-responses', REPUESTOS_API_URL);
  url.searchParams.set('question_ids', questionIds.join(','));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (REPUESTOS_API_TOKEN) headers.Authorization = `Bearer ${REPUESTOS_API_TOKEN}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`API repuestos respondió ${res.status}`);
  const body = (await res.json()) as { responses?: unknown };
  if (!Array.isArray(body.responses)) throw new Error('API repuestos devolvió respuestas inválidas');
  const responses = body.responses.filter((value): value is AgentResponse => {
    if (!value || typeof value !== 'object') return false;
    const response = value as Record<string, unknown>;
    return typeof response.question_id === 'number' && Number.isSafeInteger(response.question_id)
      && typeof response.revision === 'boolean' && typeof response.respuesta === 'string';
  });
  return new Map(responses.map((response) => [response.question_id, response]));
}

// --- Mock (solo para previsualizar) ---

function mockResponses(questionIds: number[]): AgentResponseMap {
  const responses: ({ revision: boolean; respuesta: string } | null)[] = [
    { revision: false, respuesta: '¡Hola! Sí, es compatible con tu vehículo. Tenemos stock disponible para envío inmediato. ¡Saludos!' },
    { revision: false, respuesta: 'Hola, lamentablemente no es compatible con ese modelo. Consultanos y te indicamos el repuesto correcto. ¡Saludos!' },
    { revision: true, respuesta: 'Hola, estamos verificando la compatibilidad con tu modelo exacto y te respondemos a la brevedad.' },
    null,
  ];
  const map: AgentResponseMap = new Map();
  for (const id of questionIds) {
    const response = responses[id % responses.length];
    if (!response) continue;
    map.set(id, {
      question_id: id,
      ...response,
    });
  }
  return map;
}
