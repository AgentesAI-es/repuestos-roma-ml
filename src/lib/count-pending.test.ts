import { beforeEach, describe, expect, it, vi } from 'vitest';

const filas = vi.hoisted(() => ({ value: [] as { id: number; questionId: string | null }[] }));
const ml = vi.hoisted(() => ({ estados: {} as Record<string, string | Error>, llamadas: [] as unknown[] }));

vi.mock('./server/db', () => ({ dbConfigurada: () => true }));
vi.mock('./server/revision-db', () => ({
  listarRespuestas: vi.fn(async () => ({
    total: filas.value.length,
    filas: filas.value.map((f) => ({ ...f, creadoEn: new Date(0), revisadoEn: null })),
  })),
}));
vi.mock('./server/ml-cache', () => ({
  getQuestionCacheada: vi.fn(async (id: string, connection: number, opciones?: { forzar?: boolean }) => {
    ml.llamadas.push([id, connection, opciones]);
    const estado = ml.estados[id];
    if (estado instanceof Error) throw estado;
    return { question: { id: Number(id), status: estado }, publication: null };
  }),
}));

const { countPending } = await import('./agent-responses');

describe('countPending', () => {
  beforeEach(() => {
    ml.llamadas = [];
  });

  it('no cuenta las pendientes que ML ya marca respondidas', async () => {
    filas.value = [{ id: 1, questionId: '1' }, { id: 2, questionId: '2' }, { id: 3, questionId: '3' }];
    ml.estados = { '1': 'UNANSWERED', '2': 'ANSWERED', '3': 'UNANSWERED' };
    expect(await countPending(7)).toBe(2);
  });

  it('es cero si todas las pendientes ya se respondieron en ML', async () => {
    filas.value = [{ id: 1, questionId: '1' }];
    ml.estados = { '1': 'ANSWERED' };
    expect(await countPending(7)).toBe(0);
  });

  it('si ML falla para una, la cuenta igual (no se sabe si se respondió)', async () => {
    filas.value = [{ id: 1, questionId: '1' }, { id: 2, questionId: '2' }];
    ml.estados = { '1': new Error('ML caído'), '2': 'ANSWERED' };
    expect(await countPending(7)).toBe(1);
  });

  it('pasa la cuenta y forzar al caché de ML', async () => {
    filas.value = [{ id: 1, questionId: '1' }];
    ml.estados = { '1': 'UNANSWERED' };
    await countPending(7, { forzar: true });
    expect(ml.llamadas).toEqual([['1', 7, { forzar: true }]]);
  });
});
