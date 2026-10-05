import type { APIRoute } from 'astro';
import { basicAuthChallenge, basicAuthEnabled, checkBasicAuth } from '../lib/auth';

/** Acceso directo (fuera de Chatwoot) con Basic Auth. Una vez autenticado, el navegador reenvía las credenciales. */
export const GET: APIRoute = ({ request, url }) => {
  const next = url.searchParams.get('next') ?? '/';
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!basicAuthEnabled || checkBasicAuth(request.headers.get('authorization'))) {
    return new Response(null, { status: 302, headers: { Location: target } });
  }
  return basicAuthChallenge();
};
