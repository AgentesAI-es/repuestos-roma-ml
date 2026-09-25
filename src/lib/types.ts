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

// Respuestas del agente (API de repuestos: GET /v1/respuestas-agente)

/**
 * Lo que muestra la UI por pregunta:
 * - pendiente: el agente respondió pidiendo revisión y nadie la resolvió
 * - respondida: aprobada o editada en el panel, o respondida en Mercado Libre
 * - sin_responder: el resto
 */
export type AgentStatus = 'pendiente' | 'respondida' | 'sin_responder';

/** Estado de la fila en la tabla `respuesta_agente`. */
export type RevisionStatus = 'pendiente' | 'aprobado' | 'editado';

/**
 * Una fila de `respuesta_agente`. Solo existen las que el agente mandó
 * pidiendo revisión: lo que respondió sin revisión no se registra.
 */
export interface AgentResponse {
  id: string;
  creadoEn: string;
  /** Solo dígitos, como texto (los IDs de ML no entran en un int de 32 bits). */
  questionId: string | null;
  publicacionId: string | null;
  cuenta: string | null;
  /** Lo que propuso el agente. */
  respuestaPropuesta: string;
  /** Lo que se envía al final: null si está pendiente; la propuesta si se aprobó, el texto corregido si se editó. */
  respuestaEnviada: string | null;
  status: RevisionStatus;
  revisadoPor: string | null;
  revisadoEn: string | null;
}
