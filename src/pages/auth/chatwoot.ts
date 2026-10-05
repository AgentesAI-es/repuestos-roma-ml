import type { APIRoute } from 'astro';
import { sessionCookie, verifyChatwootToken } from '../../lib/auth';

/** Recibe el api_access_token que Chatwoot pasa al iframe, lo valida y crea la sesión del panel. */
export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { api_access_token?: unknown } | null;
  const token = typeof body?.api_access_token === 'string' ? body.api_access_token : '';
  if (!token) return new Response('Falta api_access_token', { status: 400 });

  const user = await verifyChatwootToken(token);
  if (!user) return new Response('No autorizado', { status: 401 });

  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': await sessionCookie(user), 'Cache-Control': 'no-store' },
  });
};
