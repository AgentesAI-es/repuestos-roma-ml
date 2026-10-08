import type { APIRoute } from 'astro';
import { TOOL_API_KEY } from 'astro:env/server';
import { ZodError } from 'astro/zod';
import { HttpError } from '../../lib/server/errors';
import { TOOLS } from '../../lib/server/tools';

/**
 * Punto de entrada de las tools del agente: el framework manda el sobre de
 * `toolEndpointBody()` y se enruta por `tool`.
 *
 *   { tool, payload | arguments, context, timestamp?, response_id?, response_webhook? }
 *
 * Fuera de la sesión de Chatwoot y del Basic Auth del panel (lo deja pasar el
 * middleware): se autentica con `TOOL_API_KEY`, por header `x-api-key` o query
 * `?apiKey=`. Respuesta síncrona; `response_webhook` no se usa.
 *
 *   200 { ok: true, tool, resultado }
 *   400 tool desconocida o argumentos inválidos, con el detalle por campo (el
 *       framework se lo devuelve al agente para que se corrija)
 *   401 key inválida · 503 sin TOOL_API_KEY configurada
 *   5xx falló un servicio externo (Chatwoot)
 */
export const POST: APIRoute = async ({ request, url }) => {
  if (!TOOL_API_KEY) return error(503, 'TOOL_API_KEY no configurada: las tools están deshabilitadas.', 'SIN_API_KEY');
  const key = request.headers.get('x-api-key') ?? url.searchParams.get('apiKey') ?? '';
  if (!iguales(key, TOOL_API_KEY)) return error(401, 'API key inválida o ausente.', 'UNAUTHORIZED');

  const sobre = (await request.json().catch(() => null)) as {
    tool?: unknown;
    payload?: unknown;
    arguments?: unknown;
    context?: unknown;
    response_id?: unknown;
  } | null;
  if (!sobre || typeof sobre.tool !== 'string') return error(400, 'Se espera un JSON con `tool`.', 'BAD_REQUEST');

  const tool = TOOLS[sobre.tool];
  if (!tool) {
    return error(400, `Tool desconocida: ${sobre.tool}. Disponibles: ${Object.keys(TOOLS).join(', ')}`, 'TOOL_DESCONOCIDA');
  }

  try {
    const resultado = await tool.ejecutar({
      payload: objeto(sobre.payload ?? sobre.arguments),
      context: objeto(sobre.context),
    });
    console.log(`tool-execution ${sobre.tool} ok response_id=${String(sobre.response_id ?? '-')}`);
    return Response.json({ ok: true, tool: sobre.tool, resultado });
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json(
        {
          error: `Argumentos inválidos para ${sobre.tool}`,
          code: 'BAD_REQUEST',
          detalles: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
        },
        { status: 400 },
      );
    }
    if (err instanceof HttpError) return error(err.status, err.message, err.code);
    console.error(`tool-execution ${sobre.tool}`, err);
    return error(500, 'Error interno.', 'INTERNAL');
  }
};

const error = (status: number, mensaje: string, code: string) => Response.json({ error: mensaje, code }, { status });

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Comparación en tiempo constante: no filtra por cuánto tarda cuántos caracteres coinciden. */
function iguales(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}
