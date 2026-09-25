import { ML_API_URL, ML_API_TOKEN } from 'astro:env/server';
import type { ConnectionsList, Question, QuestionDetailResponse, QuestionsList } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

async function request<T>(path: string, query: Query = {}): Promise<T> {
  if (!ML_API_TOKEN) {
    throw new ApiError('Falta configurar ML_API_TOKEN en las variables de entorno.', 500);
  }

  const url = new URL(path, ML_API_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${ML_API_TOKEN}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ApiError(`No se pudo conectar con la API de Mercado Libre (${(err as Error).message}).`, 502);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Error ${res.status} en ${url.pathname}`;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

// El nav pide las cuentas en cada página: se cachean un minuto. Solo se cachea
// el éxito, así un error no queda pegado.
const CONNECTIONS_TTL_MS = 60_000;
let connectionsCache: { at: number; value: ConnectionsList } | null = null;

export async function getConnections() {
  if (connectionsCache && Date.now() - connectionsCache.at < CONNECTIONS_TTL_MS) return connectionsCache.value;
  const value = await request<ConnectionsList>('/auth/connections');
  connectionsCache = { at: Date.now(), value };
  return value;
}

/** Cuántas preguntas tiene una cuenta en ese estado: el `total` de ML, pidiendo una sola. */
export async function countQuestions(connection_id: number, status: 'UNANSWERED' | 'ANSWERED') {
  const { total } = await request<QuestionsList>('/questions', { connection_id, status, limit: 1 });
  return total;
}

export interface ListQuestionsParams {
  connection_id?: number;
  status?: string;
  /** Historial de un comprador en una publicación: los dos juntos. */
  item_id?: string;
  buyer_id?: number;
  sort?: 'asc' | 'desc';
  from_date?: string;
  to_date?: string;
  offset?: number;
  limit?: number;
}

export function listQuestions(params: ListQuestionsParams) {
  return request<QuestionsList>('/questions', { ...params });
}

/**
 * Las preguntas anteriores del mismo comprador en la misma publicación, de la
 * más vieja a la más nueva y sin la actual. `null` si no se pudo: la API
 * ignoraba `item_id` en su primera versión, así que si vuelve alguna ajena no
 * se muestra nada (un historial de otro comprador confunde más que ninguno).
 */
export async function getBuyerHistory(connection_id: number, question: Question) {
  const buyer = question.from?.id;
  if (!question.item_id || !buyer) return [];
  const { questions } = await listQuestions({ connection_id, item_id: question.item_id, buyer_id: buyer, sort: 'desc', limit: 50 });
  if (questions.some((q) => q.item_id !== question.item_id || q.from?.id !== buyer)) return null;
  return questions.filter((q) => q.id !== question.id).reverse();
}

export function getQuestion(id: string, connection_id?: number) {
  return request<QuestionDetailResponse>(`/questions/${encodeURIComponent(id)}`, { connection_id });
}
