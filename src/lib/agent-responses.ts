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
import type { AgentResponse, AgentStatus, AgentVerdict } from './types';

export type AgentResponseMap = Map<number, AgentResponse>;

export const AGENT_STATUSES: AgentStatus[] = ['si', 'no', 'inseguro', 'sin_evaluar'];

export const AGENT_STATUS_META: Record<AgentStatus, { label: string; hint: string }> = {
  si: { label: 'Sí', hint: 'Respuesta positiva publicada automáticamente' },
  no: { label: 'No', hint: 'Respuesta negativa publicada automáticamente' },
  inseguro: { label: 'Inseguro', hint: 'Pendiente de aprobación humana' },
  sin_evaluar: { label: 'Sin evaluar', hint: 'El agente todavía no procesó esta pregunta' },
};

export function isAgentStatus(value: string | null | undefined): value is AgentStatus {
  return !!value && (AGENT_STATUSES as string[]).includes(value);
}

export function agentStatusOf(map: AgentResponseMap, questionId: number): AgentStatus {
  return map.get(questionId)?.verdict ?? 'sin_evaluar';
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
  const body = (await res.json()) as { responses?: AgentResponse[] };
  return new Map((body.responses ?? []).map((r) => [Number(r.question_id), r]));
}

// --- Mock (solo para previsualizar) ---

const MOCK_TEXT: Record<AgentVerdict, string> = {
  si: '¡Hola! Sí, es compatible con tu vehículo. Tenemos stock disponible para envío inmediato. ¡Saludos!',
  no: 'Hola, lamentablemente no es compatible con ese modelo. Consultanos y te indicamos el repuesto correcto. ¡Saludos!',
  inseguro: 'Hola, estamos verificando la compatibilidad con tu modelo exacto y te respondemos a la brevedad.',
};

function mockResponses(questionIds: number[]): AgentResponseMap {
  const verdicts: (AgentVerdict | null)[] = ['si', 'no', 'inseguro', 'si', null, 'inseguro', 'si'];
  const map: AgentResponseMap = new Map();
  for (const id of questionIds) {
    const verdict = verdicts[id % verdicts.length];
    if (!verdict) continue;
    map.set(id, {
      question_id: id,
      verdict,
      answer_text: MOCK_TEXT[verdict],
      confidence: verdict === 'inseguro' ? 0.42 : 0.91,
      reasoning:
        verdict === 'inseguro'
          ? 'La publicación no indica el año del vehículo; no se puede confirmar compatibilidad.'
          : 'Compatibilidad verificada contra los atributos de la publicación.',
      created_at: new Date().toISOString(),
    });
  }
  return map;
}
