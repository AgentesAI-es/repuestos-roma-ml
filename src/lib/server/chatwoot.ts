import { CHATWOOT_TIMEOUT_MS, CHATWOOT_URL } from 'astro:env/server';
import { HttpError } from './errors';

export interface MensajeChatwoot {
  accountId: number;
  conversationId: number;
  contenido: string;
  /** Nota privada: la ve el equipo en Chatwoot, no llega al comprador. */
  privado: boolean;
  token: string;
}

/**
 * Crea un mensaje saliente en una conversación de Chatwoot con el token del
 * bot (`api_access_token`).
 *
 * Un fallo de Chatwoot sale como 502 con su status y el principio del cuerpo:
 * el framework se lo pasa al agente, y "401 de Chatwoot" o "404 conversación"
 * se distinguen de un error de este servicio.
 */
export async function enviarMensaje({
  accountId,
  conversationId,
  contenido,
  privado,
  token,
}: MensajeChatwoot): Promise<{ id: number }> {
  if (!CHATWOOT_URL) throw new HttpError(500, 'Falta CHATWOOT_URL', 'CHATWOOT_SIN_URL');
  const url = new URL(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, CHATWOOT_URL);

  let r: Response;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', api_access_token: token },
      body: JSON.stringify({ content: contenido, message_type: 'outgoing', private: privado, content_type: 'text' }),
      signal: AbortSignal.timeout(CHATWOOT_TIMEOUT_MS),
    });
  } catch (err) {
    const motivo =
      err instanceof Error && err.name === 'TimeoutError'
        ? `no respondió en ${CHATWOOT_TIMEOUT_MS} ms`
        : `inaccesible: ${err instanceof Error ? err.message : String(err)}`;
    throw new HttpError(502, `Chatwoot ${motivo}`, 'CHATWOOT_ERROR');
  }

  if (!r.ok) {
    const cuerpo = (await r.text()).slice(0, 200);
    throw new HttpError(502, `Chatwoot respondió ${r.status}: ${cuerpo}`, 'CHATWOOT_ERROR');
  }

  const mensaje = (await r.json()) as { id: number };
  return { id: mensaje.id };
}
