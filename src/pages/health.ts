import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  Response.json({ ok: true, service: 'repuestos-roma-ml-ui' }, { headers: { 'Cache-Control': 'no-store' } });
