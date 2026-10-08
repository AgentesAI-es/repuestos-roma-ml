/**
 * La cola de revisión (human in the loop): lo que el agente mandó a Chatwoot
 * pidiendo revisión, y su resolución desde el panel.
 *
 * Se escribe desde la tool `enviar_respuesta` (`registrarEnvio`) y se resuelve
 * desde el detalle de la pregunta (`resolverRevision`). Las consultas están en
 * `revision-db.ts`.
 */
import { CHATWOOT_BOT_TOKEN } from 'astro:env/server';
import { enviarMensaje } from './chatwoot';
import { HttpError } from './errors';
import * as repo from './revision-db';
import type { FilaRevision } from './revision-db';

/**
 * El ID de pregunta llega como `source_id` de Chatwoot (`meli_q_13662962403`)
 * o suelto. Se guardan solo los dígitos; sin dígitos, no hay ID.
 */
export function parsearQuestionId(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos ? digitos.slice(0, 20) : null;
}

/**
 * El ID de publicación, de donde lo deje el bot: `meli_item_id` (el atributo de
 * la conversación de Chatwoot), `publicacion_id`, o el contexto de la
 * publicación anidado (`context.publicacion.publicacion.id`).
 */
export function extraerPublicacionId(context: Record<string, unknown>): string | null {
  const anidado = (context.publicacion as { publicacion?: { id?: unknown } | null } | undefined)?.publicacion?.id;
  const id = context.meli_item_id ?? context.publicacion_id ?? anidado;
  return typeof id === 'string' && id.trim() ? id.trim().slice(0, 50) : null;
}

export type ResultadoRegistro =
  | { id: string; resultado: 'creada' | 'actualizada' }
  | { id: string; resultado: 'ya_resuelta'; status: FilaRevision['status']; revisadoPor: string | null };

/**
 * Una fila por pregunta (`question_id` es único). Si el agente vuelve a mandar
 * la misma:
 * - pendiente: se pisa con la propuesta nueva (y la nota nueva de Chatwoot),
 *   marcando `actualizado_en`;
 * - ya resuelta: no se toca. La decisión de una persona no la pisa un
 *   reintento del agente; se devuelve la fila tal como está.
 * Sin `question_id` no hay conflicto posible: siempre crea.
 */
export async function registrarEnvio(envio: repo.NuevoEnvio): Promise<ResultadoRegistro> {
  const fila = await repo.insertarOActualizarPendiente(envio);
  if (fila) return { id: fila.id, resultado: fila.creada ? 'creada' : 'actualizada' };

  // Hubo conflicto y no se actualizó: la pregunta ya estaba resuelta.
  const resuelta = await repo.filaPorPregunta(envio.questionId!);
  if (!resuelta) throw new Error(`respuesta_agente: conflicto sin fila para la pregunta ${envio.questionId}`);
  return { id: resuelta.id, resultado: 'ya_resuelta', status: resuelta.status, revisadoPor: resuelta.revisadoPor };
}

/**
 * El estado lo decide el texto, no quien revisa: sin texto, o con el mismo
 * que propuso el agente, es `aprobado`; con uno distinto, `editado`. Así una
 * "edición" que no cambió nada no cuenta como corrección.
 */
export function decidirRevision(propuesta: string, editada?: string | null) {
  const original = propuesta.trim();
  const texto = editada?.trim() || original;
  return { status: texto === original ? 'aprobado' : 'editado', texto } as const;
}

/** Encabezado de la nota que deja en Chatwoot una respuesta revisada. */
export const encabezadoRevision = (status: 'aprobado' | 'editado', revisadoPor: string) =>
  status === 'aprobado'
    ? `✅ **Respuesta aprobada por ${revisadoPor}** · la propuesta del agente queda tal cual.`
    : `✏️ **Respuesta editada por ${revisadoPor}** · reemplaza la propuesta del agente.`;

/**
 * Resuelve una revisión: `pendiente` -> `aprobado` o `editado`, guardando el
 * texto enviado y quién y cuándo. Tira `HttpError` 404 si no existe y 409 si
 * ya estaba resuelta (dos personas a la vez no se pisan: la toma es un UPDATE
 * condicionado a `pendiente`).
 *
 * Deja una nota privada en la conversación de Chatwoot con el texto final. La
 * fila se toma primero y la nota va después: si Chatwoot falla, la fila vuelve
 * a `pendiente` y el error sale como 502, así nunca queda resuelta sin nota ni
 * dos notas por dos personas a la vez. No publica nada en Mercado Libre.
 */
export async function resolverRevision(
  id: string,
  revisadoPor: string,
  respuestaEditada?: string | null,
): Promise<FilaRevision> {
  const actual = await repo.filaPorId(id);
  if (!actual) throw new HttpError(404, 'La respuesta no existe.', 'NO_EXISTE');
  if (actual.status !== 'pendiente') throw yaResuelta(actual);

  const { status, texto } = decidirRevision(actual.respuestaPropuesta, respuestaEditada);
  if (texto.length > 2000) {
    throw new HttpError(400, 'Mercado Libre acepta hasta 2000 caracteres por respuesta.', 'MUY_LARGA');
  }
  const conNota = actual.cwAccountId && actual.cwConversationId;
  // Antes de tomar la fila: sin token no hay nota, y no tiene sentido marcarla.
  if (conNota && !CHATWOOT_BOT_TOKEN) {
    throw new HttpError(
      500,
      'Falta CHATWOOT_BOT_TOKEN: sin él no se puede dejar la nota de la revisión en Chatwoot.',
      'CHATWOOT_SIN_TOKEN',
    );
  }

  const revisadoEn = new Date();
  const fila = await repo.tomarPendiente(id, { status, texto, revisadoPor, revisadoEn });
  if (!fila) {
    const ahora = await repo.filaPorId(id);
    throw ahora ? yaResuelta(ahora) : new HttpError(404, 'La respuesta no existe.', 'NO_EXISTE');
  }

  if (conNota) {
    try {
      await enviarMensaje({
        accountId: actual.cwAccountId!,
        conversationId: actual.cwConversationId!,
        contenido: `${encabezadoRevision(status, revisadoPor)}\n\n${texto}`,
        privado: true,
        token: CHATWOOT_BOT_TOKEN!,
      });
    } catch (err) {
      await repo.devolverAPendiente(id, status, revisadoEn);
      throw err;
    }
  }
  return fila;
}

const yaResuelta = (f: FilaRevision) =>
  new HttpError(409, `Ya estaba resuelta: ${f.status} por ${f.revisadoPor ?? 'desconocido'}.`, 'YA_RESUELTA');
