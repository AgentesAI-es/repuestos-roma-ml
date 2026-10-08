/**
 * Contra un Postgres de verdad: corre solo con TEST_DATABASE_URL (una base
 * descartable: crea y borra filas). Sin ella se saltea.
 *
 *   TEST_DATABASE_URL=postgres://postgres@localhost:5433/postgres npm test
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { TEST_DATABASE_URL } from '../../../test/env';
import type { NuevoEnvio } from './revision-db';

vi.mock('astro:env/server', () => import('../../../test/env'));

const { db } = await import('./db');
const repo = await import('./revision-db');
const { registrarEnvio } = await import('./revision');

const envio = (questionId: string | null, extra: Partial<NuevoEnvio> = {}): NuevoEnvio => ({
  questionId,
  publicacionId: 'MLA1',
  respuestaPropuesta: 'Sí, le va.',
  cwAccountId: 3,
  cwConversationId: 6459,
  cwMessageId: 100,
  meliConnectionId: 8,
  ...extra,
});

describe.skipIf(!TEST_DATABASE_URL)('respuesta_agente en Postgres', () => {
  beforeAll(async () => {
    const sql = await db();
    await sql`DELETE FROM respuesta_agente`;
  });
  afterAll(async () => {
    const sql = await db();
    await sql`DELETE FROM respuesta_agente`;
    await sql.end();
  });

  test('las migraciones quedan anotadas y no se repiten', async () => {
    const sql = await db();
    const hechas = await sql`SELECT nombre FROM _migraciones`;
    expect(hechas.map((m) => m.nombre)).toEqual(['0001_respuesta_agente']);
  });

  test('registrar: crea, y un reenvío de la misma pregunta pendiente la actualiza', async () => {
    const creada = await registrarEnvio(envio('111'));
    expect(creada.resultado).toBe('creada');

    const actualizada = await registrarEnvio(envio('111', { respuestaPropuesta: 'Otra propuesta', cwMessageId: 101 }));
    expect(actualizada).toEqual({ id: creada.id, resultado: 'actualizada' });

    const fila = await repo.filaPorId(creada.id);
    expect(fila).toMatchObject({
      questionId: '111',
      respuestaPropuesta: 'Otra propuesta',
      cwMessageId: 101,
      status: 'pendiente',
      meliConnectionId: 8,
    });
    expect(fila!.creadoEn).toBeInstanceOf(Date);
    expect(fila!.actualizadoEn).toBeInstanceOf(Date);
  });

  test('dos envíos simultáneos de la misma pregunta dejan una sola fila', async () => {
    const [a, b] = await Promise.all([registrarEnvio(envio('222')), registrarEnvio(envio('222'))]);
    expect(a.id).toBe(b.id);
    const { total } = await repo.listarRespuestas({ questionIds: ['222'] });
    expect(total).toBe(1);
  });

  test('tomar: una sola de dos personas gana; devolver la deja pendiente de nuevo', async () => {
    const { id } = await registrarEnvio(envio('333'));
    const revisadoEn = new Date();
    const [juan, ana] = await Promise.all([
      repo.tomarPendiente(id, { status: 'aprobado', texto: 'Sí, le va.', revisadoPor: 'Juan', revisadoEn }),
      repo.tomarPendiente(id, { status: 'editado', texto: 'Otro', revisadoPor: 'Ana', revisadoEn }),
    ]);
    expect([juan, ana].filter(Boolean)).toHaveLength(1);
    const ganador = (juan ?? ana)!;

    await repo.devolverAPendiente(id, ganador.status as 'aprobado' | 'editado', ganador.revisadoEn!);
    expect(await repo.filaPorId(id)).toMatchObject({ status: 'pendiente', respuestaEnviada: null, revisadoPor: null });
  });

  test('una ya resuelta no la pisa un reenvío del agente', async () => {
    const { id } = await registrarEnvio(envio('444'));
    await repo.tomarPendiente(id, { status: 'editado', texto: 'Corregida', revisadoPor: 'Ana', revisadoEn: new Date() });
    const r = await registrarEnvio(envio('444', { respuestaPropuesta: 'Nueva propuesta' }));
    expect(r).toEqual({ id, resultado: 'ya_resuelta', status: 'editado', revisadoPor: 'Ana' });
    expect(await repo.filaPorId(id)).toMatchObject({ respuestaPropuesta: 'Sí, le va.', respuestaEnviada: 'Corregida' });
  });

  test('sin question_id siempre crea', async () => {
    const a = await registrarEnvio(envio(null));
    const b = await registrarEnvio(envio(null));
    expect(a.id).not.toBe(b.id);
  });

  test('listar: por estados y cuenta, de la más nueva a la más vieja; total sin el límite', async () => {
    await registrarEnvio(envio('555', { meliConnectionId: 9 }));
    const pendientes8 = await repo.listarRespuestas({ statuses: ['pendiente'], meliConnectionId: 8, limite: 0 });
    const todas8 = await repo.listarRespuestas({ meliConnectionId: 8, limite: 100 });
    expect(pendientes8.filas).toEqual([]);
    expect(pendientes8.total).toBe(todas8.filas.filter((f) => f.status === 'pendiente').length);
    expect(todas8.filas.every((f) => f.meliConnectionId === 8)).toBe(true);
    const fechas = todas8.filas.map((f) => f.creadoEn.getTime());
    expect(fechas).toEqual([...fechas].sort((x, y) => y - x));

    const resueltas = await repo.listarRespuestas({ statuses: ['aprobado', 'editado'] });
    expect(resueltas.filas.map((f) => f.questionId)).toContain('444');
    expect(resueltas.filas.every((f) => f.status !== 'pendiente')).toBe(true);
  });

  test('filaPorId con un id que no es uuid: null, sin error de la base', async () => {
    expect(await repo.filaPorId('no-es-uuid')).toBeNull();
  });
});
