import type { APIRoute } from 'astro';
import { db, dbConfigurada } from '../lib/server/db';

/**
 * Healthcheck del contenedor. Con DATABASE_URL también prueba la base: así las
 * migraciones se aplican al arrancar (el primer healthcheck) y no con la
 * primera visita, y un contenedor sin base queda `unhealthy` (503).
 */
export const GET: APIRoute = async () => {
  const headers = { 'Cache-Control': 'no-store' };
  if (!dbConfigurada()) return Response.json({ ok: true, service: 'repuestos-roma-ml-ui', db: 'sin configurar' }, { headers });
  try {
    const sql = await db();
    await sql`SELECT 1`;
    return Response.json({ ok: true, service: 'repuestos-roma-ml-ui', db: 'ok' }, { headers });
  } catch (err) {
    console.error('[health] base', err);
    return Response.json({ ok: false, service: 'repuestos-roma-ml-ui', db: 'error' }, { status: 503, headers });
  }
};
