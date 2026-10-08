import { enviarRespuesta } from './enviar-respuesta';

/**
 * Una tool del agente. Recibe el sobre del framework ya separado: `payload`
 * son los argumentos que armó el LLM, `context` lo que agregó el bot.
 *
 * Valida con `.parse()` de zod: un `ZodError` sale como 400 con el detalle por
 * campo, que el framework le devuelve al agente para que se corrija solo.
 * Cualquier otro fallo se tira como `HttpError`.
 */
export interface Tool {
  descripcion: string;
  ejecutar(args: { payload: Record<string, unknown>; context: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

/** El nombre es el que el agente pone en `tool`. Agregar una tool es sumarla acá. */
export const TOOLS: Record<string, Tool> = {
  enviar_respuesta: enviarRespuesta,
};
