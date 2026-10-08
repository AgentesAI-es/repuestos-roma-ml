import {
  CHATWOOT_URL,
  CHATWOOT_ACCOUNT_ID,
  SESSION_SECRET,
  DASHBOARD_USER,
  DASHBOARD_PASSWORD,
} from 'astro:env/server';

export const SESSION_COOKIE = 'hmml_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Origen de Chatwoot (ej. https://chat.example.com). Vacío = login por Chatwoot desactivado. */
export const chatwootOrigin = CHATWOOT_URL && CHATWOOT_ACCOUNT_ID ? new URL(CHATWOOT_URL).origin : '';
export const basicAuthEnabled = Boolean(DASHBOARD_USER && DASHBOARD_PASSWORD);

// Sin SESSION_SECRET las sesiones se invalidan en cada reinicio (Chatwoot vuelve a loguear solo).
const encoder = new TextEncoder();
const hmacKey = crypto.subtle.importKey(
  'raw',
  SESSION_SECRET ? encoder.encode(SESSION_SECRET) : crypto.getRandomValues(new Uint8Array(32)),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign', 'verify'],
);

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export interface SessionUser {
  id: number;
  name: string;
  exp: number;
}

/** Cookie firmada. SameSite=None + Partitioned para que funcione dentro del iframe de Chatwoot. */
export async function sessionCookie(user: { id: number; name: string }): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = toBase64Url(encoder.encode(JSON.stringify({ ...user, exp })));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey, encoder.encode(payload)));
  return `${SESSION_COOKIE}=${payload}.${toBase64Url(signature)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None; Partitioned`;
}

export async function readSession(value: string | undefined): Promise<SessionUser | null> {
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;

  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey, fromBase64Url(signature), encoder.encode(payload));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as SessionUser;
    return session.exp > Date.now() / 1000 ? session : null;
  } catch {
    return null;
  }
}

/**
 * Valida el api_access_token del agente contra Chatwoot y comprueba que pertenezca a la cuenta configurada.
 * El token no se guarda: sólo se usa para esta consulta.
 */
export async function verifyChatwootToken(token: string): Promise<{ id: number; name: string } | null> {
  if (!chatwootOrigin) return null;

  let res: Response;
  try {
    res = await fetch(new URL('/api/v1/profile', chatwootOrigin), {
      headers: { api_access_token: token, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const profile = (await res.json()) as {
    id: number;
    name?: string;
    available_name?: string;
    accounts?: { id: number }[];
  };
  const belongs = profile.accounts?.some((account) => account.id === CHATWOOT_ACCOUNT_ID);
  return belongs ? { id: profile.id, name: profile.available_name || profile.name || '' } : null;
}

export function checkBasicAuth(header: string | null): boolean {
  if (!basicAuthEnabled) return false;
  const [scheme, encoded] = (header ?? '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;

  let decoded = '';
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  return sep > -1 && decoded.slice(0, sep) === DASHBOARD_USER && decoded.slice(sep + 1) === DASHBOARD_PASSWORD;
}

export const basicAuthChallenge = () =>
  new Response('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="HM-ML", charset="UTF-8"' },
  });

/**
 * Página intermedia cuando no hay sesión. Dentro del iframe de Chatwoot pide las credenciales por
 * postMessage (contrato AUTH_TOKEN / CRM_AUTH_REQUEST de las secciones custom), crea la sesión y recarga.
 * Fuera de Chatwoot manda a /login (Basic Auth) si está configurado.
 */
export function embedAuthPage(): Response {
  const config = JSON.stringify({ origin: chatwootOrigin, basic: basicAuthEnabled });
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>HM-ML · Preguntas de Mercado Libre</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 15px system-ui, sans-serif; color: #475569; background: #f8fafc; }
</style>
</head>
<body>
<p id="msg">Validando sesión de Chatwoot…</p>
<script>
  const { origin, basic } = ${config};
  const RETRY_KEY = 'hmml_auth_retry';
  const msg = document.getElementById('msg');
  const fail = (text) => { msg.textContent = text; };

  if (window.parent === window) {
    if (basic) location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
    else fail('Abrí este panel desde Chatwoot.');
  } else {
    // Si recién recargamos tras validar y seguimos sin sesión, el navegador está bloqueando la cookie.
    let recentRetry = false;
    try {
      recentRetry = Date.now() - Number(sessionStorage.getItem(RETRY_KEY) || 0) < 15000;
      sessionStorage.removeItem(RETRY_KEY);
    } catch {}

    let done = false;
    const timeout = setTimeout(() => { if (!done) fail('Chatwoot no respondió. Recargá la página.'); }, 10000);

    window.addEventListener('message', async (event) => {
      if (done || event.origin !== origin || event.data?.type !== 'AUTH_TOKEN') return;
      done = true;
      clearTimeout(timeout);
      if (recentRetry) return fail('El navegador bloqueó la cookie de sesión. Revisá la configuración de cookies de terceros.');

      const token = event.data.payload?.api_access_token;
      if (!token) return fail('Chatwoot no envió credenciales. Recargá la página.');

      const res = await fetch('/auth/chatwoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_access_token: token }),
      }).catch(() => null);
      if (!res?.ok) return fail('Tu usuario de Chatwoot no tiene acceso a este panel.');

      try { sessionStorage.setItem(RETRY_KEY, String(Date.now())); } catch {}
      location.reload();
    });

    window.parent.postMessage({ type: 'CRM_AUTH_REQUEST' }, origin);
  }
</script>
</body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
