// Tipos de la API de Mercado Libre (ver /openapi.json)

export interface Connection {
  id: number;
  user_id: number;
  nickname: string | null;
  label: string | null;
  expires_at: string;
  updated_at: string;
  authenticated: boolean;
  refreshed: boolean;
}

export interface ConnectionsList {
  total: number;
  connections: Connection[];
  login_url: string;
}

export interface Publication {
  item_id: string | null;
  title: string | null;
  permalink: string | null;
  price: number | null;
  currency_id: string | null;
  thumbnail: string | null;
  status: string | null;
}

export interface Question {
  id: number;
  text: string;
  status: string;
  item_id: string | null;
  date_created: string | null;
  seller_id: number | null;
  from: { id: number | null; nickname: string | null };
  answer: { text: string | null; status: string | null; date_created: string | null } | null;
}

export interface QuestionListItem extends Question {
  publication?: Publication | null;
}

export interface QuestionsList {
  connection_id: number;
  seller_id: number;
  total: number;
  limit: number;
  offset: number;
  sort: 'asc' | 'desc';
  from_date: string | null;
  to_date: string | null;
  questions: QuestionListItem[];
}

export interface ItemAttribute {
  id: string;
  name: string;
  value_name: string | null;
  attribute_group_id: string | null;
  attribute_group_name: string | null;
}

export interface ItemSummary {
  id: string;
  title: string | null;
  price: number | null;
  currency_id: string | null;
  available_quantity: number | null;
  sold_quantity: number | null;
  condition: string | null;
  permalink: string | null;
  thumbnail: string | null;
  secure_thumbnail: string | null;
  status: string | null;
  pictures?: { id: string | null; url: string | null; secure_url: string | null }[];
  attributes?: ItemAttribute[];
  partial?: boolean;
  error?: string | null;
}

export interface QuestionDetailResponse {
  connection_id: number;
  seller_id: number;
  question: Question;
  item: ItemSummary | null;
  publication: Publication | null;
}

// Respuestas del agente (API de repuestos — fase 2)

/** Estado que muestra la UI según si la respuesta necesita revisión humana. */
export type AgentStatus = 'revision' | 'sin_revision' | 'sin_evaluar';

export interface AgentResponse {
  /** Identificador añadido por la API para asociar la salida del agente a la pregunta. */
  question_id: number;
  /** Campos de la tool del agente. */
  revision: boolean;
  respuesta: string;
}
