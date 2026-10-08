import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetEnv, setEnv } from '../../../test/env';
import type { FilaRevision } from './revision-db';

vi.mock('astro:env/server', () => import('../../../test/env'));

// La base se reemplaza por una fila en memoria: estos tests no escriben filas.
let fila: FilaRevision;
vi.mock('./revision-db', () => ({
  filaPorId: vi.fn(async () => ({ ...fila })),
  tomarPendiente: vi.fn(async (_id: string, c: { status: 'aprobado' | 'editado'; texto: string; revisadoPor: string; revisadoEn: Date }) => {
    if (fila.status !== 'pendiente') return null;
    Object.assign(fila, { status: c.status, respuestaEnviada: c.texto, revisadoPor: c.revisadoPor, revisadoEn: c.revisadoEn });
    return { ...fila };
  }),
  devolverAPendiente: vi.fn(async () => {
    Object.assign(fila, { status: 'pendiente', respuestaEnviada: null, revisadoPor: null, revisadoEn: null });
  }),
}));

const { decidirRevision, extraerPublicacionId, parsearQuestionId, resolverRevision } = await import('./revision');
const repo = await import('./revision-db');

beforeEach(() => {
  fila = {
    id: '00000000-0000-0000-0000-000000000001',
    creadoEn: new Date(),
    actualizadoEn: null,
    questionId: '13662962403',
    publicacionId: 'MLA704095902',
    respuestaPropuesta: 'Sí, le va.',
    respuestaEnviada: null,
    status: 'pendiente',
    cwAccountId: 3,
    cwConversationId: 6459,
    cwMessageId: 1,
    meliConnectionId: 8,
    revisadoPor: null,
    revisadoEn: null,
  };
  setEnv({ CHATWOOT_BOT_TOKEN: 'token-del-bot' });
});
afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test('question_id: se guardan solo los dígitos del source_id de Chatwoot', () => {
  expect(parsearQuestionId('meli_q_13662962403')).toBe('13662962403');
  expect(parsearQuestionId('13662962403')).toBe('13662962403');
  expect(parsearQuestionId(13662962403)).toBe('13662962403');
  expect(parsearQuestionId('meli_q_')).toBe(null);
  expect(parsearQuestionId(undefined)).toBe(null);
  expect(parsearQuestionId({})).toBe(null);
});

test('publicacion_id: meli_item_id, publicacion_id o el contexto anidado', () => {
  expect(extraerPublicacionId({ meli_item_id: 'MLA2' })).toBe('MLA2');
  expect(extraerPublicacionId({ publicacion_id: 'MLA1' })).toBe('MLA1');
  expect(extraerPublicacionId({ publicacion: { publicacion: { id: 'MLA704095902' } } })).toBe('MLA704095902');
  expect(extraerPublicacionId({ publicacion: { publicacion: null } })).toBe(null);
  expect(extraerPublicacionId({})).toBe(null);
});

test('decidirRevision: sin texto o con el mismo, aprobado; con otro, editado', () => {
  expect(decidirRevision('Sí, le va.')).toEqual({ status: 'aprobado', texto: 'Sí, le va.' });
  expect(decidirRevision('Sí, le va.', '   ')).toEqual({ status: 'aprobado', texto: 'Sí, le va.' });
  expect(decidirRevision('Sí, le va.', ' Sí, le va. ')).toEqual({ status: 'aprobado', texto: 'Sí, le va.' });
  expect(decidirRevision('Sí, le va.', 'Sí, le va al Golf 94.')).toEqual({ status: 'editado', texto: 'Sí, le va al Golf 94.' });
});

test('aprobar: guarda la propuesta como enviada y deja una nota privada en la conversación', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 776 }));
  const r = await resolverRevision(fila.id, 'Juan');
  expect(r).toMatchObject({ status: 'aprobado', respuestaEnviada: 'Sí, le va.', revisadoPor: 'Juan' });
  const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toBe('https://chat.example.com/api/v1/accounts/3/conversations/6459/messages');
  const body = JSON.parse(String(init?.body));
  expect(body.private).toBe(true);
  expect(body.content).toBe('✅ **Respuesta aprobada por Juan** · la propuesta del agente queda tal cual.\n\nSí, le va.');
});

test('aprobar sin conversación de Chatwoot: se resuelve igual, sin nota', async () => {
  fila.cwConversationId = null;
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(resolverRevision(fila.id, 'Juan')).resolves.toMatchObject({ status: 'aprobado' });
  expect(fetch).not.toHaveBeenCalled();
});

test('editar: guarda el texto corregido y deja una nota privada', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 777 }));
  const r = await resolverRevision(fila.id, 'Juan', 'Sí, le va al Golf 94.');
  expect(r).toMatchObject({ status: 'editado', respuestaEnviada: 'Sí, le va al Golf 94.' });
  const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
  expect(body.content).toBe('✏️ **Respuesta editada por Juan** · reemplaza la propuesta del agente.\n\nSí, le va al Golf 94.');
});

test('editar con Chatwoot caído: la fila vuelve a pendiente y el error sale como 502', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
  await expect(resolverRevision(fila.id, 'Juan', 'Otro texto')).rejects.toMatchObject({ status: 502 });
  expect(fila).toMatchObject({ status: 'pendiente', respuestaEnviada: null, revisadoPor: null });
});

test('sin CHATWOOT_BOT_TOKEN: falla antes de tocar la fila', async () => {
  setEnv({ CHATWOOT_BOT_TOKEN: undefined });
  await expect(resolverRevision(fila.id, 'Juan')).rejects.toMatchObject({ code: 'CHATWOOT_SIN_TOKEN' });
  expect(repo.tomarPendiente).not.toHaveBeenCalled();
  expect(fila.status).toBe('pendiente');
});

test('ya resuelta: 409 y no la pisa', async () => {
  fila.status = 'editado';
  fila.revisadoPor = 'Ana';
  await expect(resolverRevision(fila.id, 'Juan')).rejects.toMatchObject({ status: 409, code: 'YA_RESUELTA' });
  expect(repo.tomarPendiente).not.toHaveBeenCalled();
});

test('no existe: 404', async () => {
  vi.mocked(repo.filaPorId).mockResolvedValueOnce(null);
  await expect(resolverRevision('x', 'Juan')).rejects.toMatchObject({ status: 404 });
});
