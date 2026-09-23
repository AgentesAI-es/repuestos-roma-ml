import { ML_API_URL, ML_API_TOKEN } from 'astro:env/server';
import type { ConnectionsList, QuestionDetailResponse, QuestionsList } from './types';

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

export function getConnections() {
  return request<ConnectionsList>('/auth/connections');
}

export interface ListQuestionsParams {
  connection_id?: number;
  status?: string;
  sort?: 'asc' | 'desc';
  from_date?: string;
  to_date?: string;
  offset?: number;
  limit?: number;
}

export function listQuestions(params: ListQuestionsParams) {
  return request<QuestionsList>('/questions', { ...params });
}

export function getQuestion(id: string, connection_id?: number) {
  return request<QuestionDetailResponse>(`/questions/${encodeURIComponent(id)}`, { connection_id });
}
