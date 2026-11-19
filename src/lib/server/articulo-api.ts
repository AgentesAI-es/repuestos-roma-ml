/**
 * API de Repuestos Roma: la réplica del ERP (artículo, stock por depósito y
 * precio de la lista de la publicación). El detalle de una pregunta la usa
 * para la pestaña "Artículo".
 *
 * Nunca tira: el detalle carga igual si la API no está configurada, no
 * responde o la publicación no está vinculada a un artículo.
 */
import { REPUESTOS_ROMA_API_KEY, REPUESTOS_ROMA_API_URL } from 'astro:env/server';

export interface ArticuloErp {
  codigo: string;
  descripcion: string;
  descripcionAdicional: string | null;
  observaciones: string | null;
  codigoProveedor: string | null;
  equivalencias: string | null;
  tipo: string | null;
  marca: string | null;
  vehiculo: string | null;
  stockTotal: number;
  porDeposito: Record<string, number> | null;
  precio: number | null;
  activo: boolean;
}

export interface PublicacionErp {
  id: string;
  cuenta: string;
  listaCodigo: string;
  esFull: boolean;
  articulo: ArticuloErp;
}

export type ResultadoArticulo =
  | { estado: 'ok'; publicacion: PublicacionErp }
  | { estado: 'no_vinculado' }
  | { estado: 'sin_configurar' }
  | { estado: 'error'; mensaje: string };

const TIMEOUT_MS = 8_000;

export async function getArticuloDePublicacion(itemId: string | null | undefined): Promise<ResultadoArticulo> {
  if (!REPUESTOS_ROMA_API_URL) return { estado: 'sin_configurar' };
  if (!itemId) return { estado: 'no_vinculado' };

  const url = new URL(`/v1/publicaciones-ml/${encodeURIComponent(itemId)}`, REPUESTOS_ROMA_API_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-api-key': REPUESTOS_ROMA_API_KEY ?? '', Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { estado: 'error', mensaje: `No se pudo conectar con la API de Repuestos Roma (${(err as Error).message}).` };
  }

  const body = await res.json().catch(() => null);
  // 404 con NOT_FOUND = la publicación no está en el ERP (o apunta a un artículo inexistente).
  if (res.status === 404) return { estado: 'no_vinculado' };
  if (!res.ok) {
    const mensaje = (body as { error?: string } | null)?.error ?? `Error ${res.status} de la API de Repuestos Roma`;
    return { estado: 'error', mensaje };
  }
  return { estado: 'ok', publicacion: body as PublicacionErp };
}
