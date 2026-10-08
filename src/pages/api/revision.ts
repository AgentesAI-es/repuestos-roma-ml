import type { APIRoute } from 'astro';
import { HttpError } from '../../lib/server/errors';
import { resolverRevision } from '../../lib/server/revision';
import { invalidarResumen } from '../../lib/server/resumen';
import { SESSION_COOKIE, readSession } from '../../lib/auth';

/**
 * Aprobar o editar una respuesta del agente desde el detalle de la
 * pregunta. Recibe el form (sin JS) y resuelve la fila en la base propia.
 *
 * Un solo form: manda el texto del cuadro de respuesta y la API decide. Si
 * no cambió, queda aprobada; si cambió, editada (y deja una nota privada en
 * Chatwoot). Sin texto, se aprueba tal cual. No publica nada en Mercado Libre
 * (fase de desarrollo).
 * Vuelve al detalle con `?revision=` (ok) o `?revision_error=` (mensaje),
 * conservando `embed=1` si venía del modal. El "Aprobar" de la card de la
 * bandeja manda `volver` (la URL de la lista) y vuelve ahí.
 */
export const POST: APIRoute = async ({ request, redirect, cookies }) => {
  const form = await request.formData();
  const id = String(form.get('id') ?? '');
  const respuesta = String(form.get('respuesta') ?? '').trim();
  const questionId = String(form.get('question_id') ?? '');
  const connection = String(form.get('connection') ?? '');
  const embed = form.get('embed') === '1';
  const lista = rutaLocal(String(form.get('volver') ?? ''));

  const volver = (params: Record<string, string>) => {
    if (lista) {
      const u = new URL(lista, 'http://x');
      for (const k of ['revision', 'revision_error']) u.searchParams.delete(k);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return redirect(`${u.pathname}${u.search}`, 303);
    }
    const destino = new URLSearchParams({ ...(connection ? { connection } : {}), ...(embed ? { embed: '1' } : {}), ...params });
    return redirect(/^\d+$/.test(questionId) ? `/preguntas/${questionId}?${destino}` : '/', 303);
  };

  if (!id) return volver({ revision_error: 'Pedido inválido.' });

  try {
    const sesion = await readSession(cookies.get(SESSION_COOKIE)?.value);
    const fila = await resolverRevision(id, sesion?.name || usuarioDelPanel(request), respuesta || undefined);
    // Una pendiente menos: que la card de la cuenta no muestre el número viejo.
    if (fila.meliConnectionId) invalidarResumen(fila.meliConnectionId);
    return volver({ revision: fila.status });
  } catch (err) {
    console.error('[revision]', err);
    const mensaje = err instanceof HttpError ? err.message : 'No se pudo resolver la revisión.';
    return volver({ revision_error: mensaje });
  }
};

/** Solo rutas de este sitio (`/…`, no `//otro.com`): nada de redirecciones afuera. */
function rutaLocal(valor: string): string | null {
  return /^\/(?![/\\])/.test(valor) ? valor : null;
}

/** Sin sesión de Chatwoot: el usuario del Basic Auth del panel; si el panel no tiene login, "panel". */
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
