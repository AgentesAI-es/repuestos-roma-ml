import { z } from 'astro/zod';
import { CHATWOOT_BOT_TOKEN, ML_RESPUESTA_PUBLICA } from 'astro:env/server';
import { enviarMensaje } from '../chatwoot';
import { HttpError } from '../errors';
import { extraerPublicacionId, parsearQuestionId, registrarEnvio, type ResultadoRegistro } from '../revision';
import type { Tool } from './index';

/** Los LLM a veces mandan el booleano como texto. */
const booleano = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

const PayloadSchema = z.object({
  respuesta: z
    .string({ error: 'Falta el texto a enviar' })
    .trim()
    .min(1, 'La respuesta está vacía')
    // Tope de Mercado Libre para la respuesta a una pregunta.
    .max(2000, 'Mercado Libre acepta hasta 2000 caracteres por respuesta'),
  revision: booleano.default(false),
});

/**
 * Lo pone el bot de Chatwoot en el contexto; llega como texto. Las claves son
 * `cw_account_id` / `cw_conversation_id`; las viejas sin prefijo se aceptan
 * mientras se actualiza el bot.
 */
const ContextSchema = z.preprocess(
  (c) => {
    const ctx = (c ?? {}) as Record<string, unknown>;
    return {
      ...ctx,
      cw_account_id: ctx.cw_account_id ?? ctx.account_id,
      cw_conversation_id: ctx.cw_conversation_id ?? ctx.conversation_id,
    };
  },
  z.object({
    cw_account_id: z.coerce.number().int().positive(),
    cw_conversation_id: z.coerce.number().int().positive(),
    bot_key: z.string().optional(),
  }),
);

/**
 * Encabezado de la nota privada cuando el agente pide revisión, para que en
 * Chatwoot quede claro que el comprador todavía no la vio. Va solo en la nota:
 * en `respuesta_agente` se guarda el texto limpio, que es lo que se publicaría.
 */
export const ENCABEZADO_REVISION =
  '⏳ **Pendiente de revisión** · respuesta propuesta por el agente, todavía no enviada al comprador.';

/**
 * Entero positivo o null. Para lo que solo se registra: un template vacío
 * (`""`) o un valor raro no puede frenar el envío.
 */
const enteroOpcional = (v: unknown) => {
  const n = Number(v);
  return v !== '' && v !== null && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Deja la respuesta del agente en la conversación de Chatwoot.
 *
 * Sale como nota privada si el agente pidió revisión, o si
 * `ML_RESPUESTA_PUBLICA` está apagado: en el inbox de ML un mensaje público se
 * publica como respuesta en Mercado Libre, y eso no se puede deshacer. El
 * resultado le dice al agente a dónde fue, para que no afirme que le contestó
 * al comprador cuando quedó en una nota.
 */
export const enviarRespuesta: Tool = {
  descripcion: 'Envía la respuesta del agente a la conversación de Chatwoot.',
  async ejecutar({ payload, context }) {
    const { respuesta, revision } = PayloadSchema.parse(payload);
    const { cw_account_id, cw_conversation_id, bot_key } = ContextSchema.parse(context);

    const token = CHATWOOT_BOT_TOKEN || bot_key;
    if (!token) {
      throw new HttpError(
        500,
        'Sin token de Chatwoot: falta CHATWOOT_BOT_TOKEN y el contexto no trae bot_key',
        'CHATWOOT_SIN_TOKEN',
      );
    }

    const privado = revision || !ML_RESPUESTA_PUBLICA;
    const { id } = await enviarMensaje({
      accountId: cw_account_id,
      conversationId: cw_conversation_id,
      contenido: revision ? `${ENCABEZADO_REVISION}\n\n${respuesta}` : respuesta,
      privado,
      token,
    });

    // Solo se registra lo que pidió revisión: la tabla es la cola para el
    // equipo, no un log de todo lo enviado. Después de enviar, y sin tirar si
    // falla: el mensaje ya está en Chatwoot y un error haría que el agente
    // reintente y lo mande dos veces.
    let registro: ResultadoRegistro | null = null;
    if (revision) {
      try {
        registro = await registrarEnvio({
          questionId: parsearQuestionId(context.question_id),
          publicacionId: extraerPublicacionId(context),
          respuestaPropuesta: respuesta,
          cwAccountId: cw_account_id,
          cwConversationId: cw_conversation_id,
          cwMessageId: id,
          meliConnectionId: enteroOpcional(context.meli_connection_id),
        });
      } catch (err) {
        console.error(`enviar_respuesta: mensaje ${id} enviado pero no registrado`, err);
      }
    }

    return {
      cwMessageId: id,
      registroId: registro?.id ?? null,
      /** creada / actualizada (ya había una pendiente de esta pregunta) / ya_resuelta. */
      registro: registro?.resultado ?? null,
      enviadoComo: privado ? ('nota_privada' as const) : ('respuesta_publica' as const),
      motivo: motivo(registro, revision, privado),
    };
  },
};

/** Lo que se le dice al agente sobre a dónde fue su respuesta. */
function motivo(registro: ResultadoRegistro | null, revision: boolean, privado: boolean) {
  if (registro?.resultado === 'ya_resuelta') {
    const quien = registro.revisadoPor ? ` por ${registro.revisadoPor}` : '';
    return `Quedó como nota privada, pero esta pregunta ya fue revisada (${registro.status}${quien}): tu respuesta no reemplaza esa decisión.`;
  }
  if (revision) return 'Pediste revisión: quedó como nota privada para el equipo.';
  if (privado) return 'Las respuestas públicas están desactivadas: quedó como nota privada.';
  return 'Enviada al comprador.';
}
