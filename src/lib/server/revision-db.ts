/**
 * Las consultas de `respuesta_agente`, sin reglas: las reglas viven en
 * `revision.ts`, que se testea reemplazando este módulo.
 */
import { db } from './db';
import type { RevisionStatus } from '../types';

export interface FilaRevision {
  id: string;
  creadoEn: Date;
  actualizadoEn: Date | null;
  questionId: string | null;
  publicacionId: string | null;
  respuestaPropuesta: string;
  respuestaEnviada: string | null;
  status: RevisionStatus;
  cwAccountId: number | null;
  cwConversationId: number | null;
  cwMessageId: number | null;
  meliConnectionId: number | null;
  revisadoPor: string | null;
  revisadoEn: Date | null;
}

const COLUMNAS = `
  id::text AS id, creado_en AS "creadoEn", actualizado_en AS "actualizadoEn",
  question_id AS "questionId", publicacion_id AS "publicacionId",
  respuesta_propuesta AS "respuestaPropuesta", respuesta_enviada AS "respuestaEnviada",
  status::text AS status, cw_account_id AS "cwAccountId", cw_conversation_id AS "cwConversationId",
  cw_message_id AS "cwMessageId", meli_connection_id AS "meliConnectionId",
  revisado_por AS "revisadoPor", revisado_en AS "revisadoEn"`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NuevoEnvio {
  questionId: string | null;
  publicacionId: string | null;
  respuestaPropuesta: string;
  cwAccountId: number;
  cwConversationId: number;
  cwMessageId: number;
  meliConnectionId: number | null;
}

/**
 * Un solo `INSERT ... ON CONFLICT ... WHERE status = 'pendiente'`: dos envíos
 * simultáneos de la misma pregunta no crean dos filas, y una ya resuelta no se
 * toca (no devuelve fila). `xmax = 0` distingue una insertada de una actualizada.
 */
export async function insertarOActualizarPendiente(e: NuevoEnvio): Promise<{ id: string; creada: boolean } | null> {
  const sql = await db();
  const [fila] = await sql<{ id: string; creada: boolean }[]>`
    INSERT INTO respuesta_agente (
      question_id, publicacion_id, respuesta_propuesta,
      cw_account_id, cw_conversation_id, cw_message_id, meli_connection_id
    ) VALUES (
      ${e.questionId}, ${e.publicacionId}, ${e.respuestaPropuesta},
      ${e.cwAccountId}, ${e.cwConversationId}, ${e.cwMessageId}, ${e.meliConnectionId}
    )
    ON CONFLICT (question_id) DO UPDATE SET
      publicacion_id = EXCLUDED.publicacion_id,
      respuesta_propuesta = EXCLUDED.respuesta_propuesta,
      cw_account_id = EXCLUDED.cw_account_id,
      cw_conversation_id = EXCLUDED.cw_conversation_id,
      cw_message_id = EXCLUDED.cw_message_id,
      meli_connection_id = EXCLUDED.meli_connection_id,
      actualizado_en = now()
    WHERE respuesta_agente.status = 'pendiente'
    RETURNING id::text AS id, (xmax = 0) AS creada`;
  return fila ?? null;
}

export async function filaPorId(id: string): Promise<FilaRevision | null> {
  if (!UUID.test(id)) return null;
  const sql = await db();
  const [fila] = await sql<FilaRevision[]>`SELECT ${sql.unsafe(COLUMNAS)} FROM respuesta_agente WHERE id = ${id}`;
  return fila ?? null;
}

export async function filaPorPregunta(questionId: string): Promise<FilaRevision | null> {
  const sql = await db();
  const [fila] = await sql<FilaRevision[]>`
    SELECT ${sql.unsafe(COLUMNAS)} FROM respuesta_agente WHERE question_id = ${questionId}`;
  return fila ?? null;
}

/** Pasa una `pendiente` a resuelta. null si ya no estaba pendiente (otra persona ganó). */
export async function tomarPendiente(
  id: string,
  cambio: { status: 'aprobado' | 'editado'; texto: string; revisadoPor: string; revisadoEn: Date },
): Promise<FilaRevision | null> {
  const sql = await db();
  const [fila] = await sql<FilaRevision[]>`
    UPDATE respuesta_agente SET
      status = ${cambio.status}, respuesta_enviada = ${cambio.texto},
      revisado_por = ${cambio.revisadoPor}, revisado_en = ${cambio.revisadoEn}
    WHERE id = ${id} AND status = 'pendiente'
    RETURNING ${sql.unsafe(COLUMNAS)}`;
  return fila ?? null;
}

/** Deshace `tomarPendiente`, solo si nadie la tocó después. */
export async function devolverAPendiente(id: string, status: 'aprobado' | 'editado', revisadoEn: Date) {
  const sql = await db();
  await sql`
    UPDATE respuesta_agente SET status = 'pendiente', respuesta_enviada = NULL, revisado_por = NULL, revisado_en = NULL
    WHERE id = ${id} AND status = ${status} AND revisado_en = ${revisadoEn}`;
}

export interface FiltrosRespuestas {
  statuses?: RevisionStatus[];
  questionIds?: string[];
  meliConnectionId?: number;
  limite?: number;
}

/** De la más nueva a la más vieja. `total` cuenta todas las que coinciden, sin el límite. */
export async function listarRespuestas({ statuses, questionIds, meliConnectionId, limite = 50 }: FiltrosRespuestas) {
  const sql = await db();
  const condiciones = [
    statuses?.length ? sql`status::text IN ${sql(statuses)}` : null,
    questionIds?.length ? sql`question_id IN ${sql(questionIds)}` : null,
    meliConnectionId ? sql`meli_connection_id = ${meliConnectionId}` : null,
  ].filter((c) => c !== null);
  const where = condiciones.length
    ? sql`WHERE ${condiciones.reduce((acc, c) => sql`${acc} AND ${c}`)}`
    : sql``;

  const [[{ total }], filas] = await Promise.all([
    sql<{ total: number }[]>`SELECT count(*)::int AS total FROM respuesta_agente ${where}`,
    sql<FilaRevision[]>`
      SELECT ${sql.unsafe(COLUMNAS)} FROM respuesta_agente ${where}
      ORDER BY creado_en DESC LIMIT ${limite}`,
  ]);
  return { total, filas };
}
