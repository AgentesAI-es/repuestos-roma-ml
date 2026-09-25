import type { APIRoute } from 'astro';
import { RevisionError, resolveRevision } from '../../lib/agent-responses';

/**
 * Aprobar / desaprobar una respuesta del agente desde el detalle de la
 * pregunta. Recibe el form (sin JS) y reenvía el PATCH a la API de repuestos
 * desde el servidor, así la API key no pasa por el navegador.
 *
 * Solo deja constancia: no publica nada en Mercado Libre (fase de desarrollo).
 * Vuelve al detalle con `?revision=` (ok) o `?revision_error=` (mensaje).
 */
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const status = String(form.get('status') ?? '');
  const questionId = String(form.get('question_id') ?? '');
  const connection = String(form.get('connection') ?? '');

  const volver = (params: Record<string, string>) => {
    const destino = new URLSearchParams({ ...(connection ? { connection } : {}), ...params });
    return redirect(/^\d+$/.test(questionId) ? `/preguntas/${questionId}?${destino}` : '/', 303);
  };

  if (!id || (status !== 'aprobado' && status !== 'desaprobado')) {
    return volver({ revision_error: 'Pedido inválido.' });
  }

  try {
    await resolveRevision(id, status, usuarioDelPanel(request));
    return volver({ revision: status });
  } catch (err) {
    console.error('[revision]', err);
    const mensaje = err instanceof RevisionError ? err.message : 'No se pudo contactar la API de repuestos.';
    return volver({ revision_error: mensaje });
  }
};

/** El usuario del Basic Auth del panel; si el panel no tiene login, "panel". */
function usuarioDelPanel(request: Request): string {
  const [scheme, encoded] = (request.headers.get('authorization') ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return 'panel';
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
    const sep = decoded.indexOf(':');
    return sep > 0 ? decoded.slice(0, sep) : 'panel';
  } catch {
    return 'panel';
  }
}
