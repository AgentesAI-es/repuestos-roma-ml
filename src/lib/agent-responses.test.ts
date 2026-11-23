import { describe, expect, it } from 'vitest';
import { agentStatusOf, ordenarParaRevisar, type AgentResponseMap } from './agent-responses';
import { dayToIso } from './format';
import type { AgentResponse, QuestionListItem } from './types';

const fila = (questionId: number, status: AgentResponse['status']) =>
  ({ id: questionId, questionId: String(questionId), status }) as unknown as AgentResponse;

describe('agentStatusOf', () => {
  it('una pendiente que ML ya marca respondida deja de estar para revisar', () => {
    const map: AgentResponseMap = new Map([[1, fila(1, 'pendiente')]]);
    expect(agentStatusOf(map, { id: 1, status: 'ANSWERED' })).toBe('respondida');
  });

  it('una pendiente sin responder en ML sigue pendiente', () => {
    const map: AgentResponseMap = new Map([[1, fila(1, 'pendiente')]]);
    expect(agentStatusOf(map, { id: 1, status: 'UNANSWERED' })).toBe('pendiente');
  });

  it('sin fila ni respuesta en ML queda sin responder', () => {
    expect(agentStatusOf(new Map(), { id: 1, status: 'UNANSWERED' })).toBe('sin_responder');
  });
});

const q = (id: number, date_created: string, status = 'UNANSWERED') => ({ id, date_created, status }) as QuestionListItem;

describe('ordenarParaRevisar', () => {
  // 10:30 -04:00 es 14:30Z: más nueva que 12:00Z aunque el texto diga lo contrario.
  const preguntas = [q(1, '2026-11-20T12:00:00.000Z'), q(2, '2026-11-20T10:30:00.000-04:00'), q(3, '2026-11-19T09:00:00.000-04:00')];

  it('ordena por fecha real, más nuevas primero', () => {
    expect(ordenarParaRevisar(preguntas, { sort: 'desc' }).map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it('ordena por fecha real, más viejas primero', () => {
    expect(ordenarParaRevisar(preguntas, { sort: 'asc' }).map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it('filtra desde/hasta por fecha real', () => {
    const desde = '2026-11-20T13:00:00.000Z';
    expect(ordenarParaRevisar(preguntas, { sort: 'desc', desde }).map((p) => p.id)).toEqual([2]);
    const hasta = '2026-11-20T13:00:00.000Z';
    expect(ordenarParaRevisar(preguntas, { sort: 'desc', hasta }).map((p) => p.id)).toEqual([1, 3]);
  });

  it('saca las que ya están respondidas en ML si se pide', () => {
    const con = [...preguntas, q(4, '2026-11-21T00:00:00.000Z', 'ANSWERED')];
    expect(ordenarParaRevisar(con, { sort: 'desc', sinRespondidas: true }).map((p) => p.id)).toEqual([2, 1, 3]);
    expect(ordenarParaRevisar(con, { sort: 'desc' }).map((p) => p.id)).toEqual([4, 2, 1, 3]);
  });

  it('las que no tienen fecha van al final', () => {
    const con = [q(5, null as unknown as string), ...preguntas];
    expect(ordenarParaRevisar(con, { sort: 'desc' }).map((p) => p.id)).toEqual([2, 1, 3, 5]);
  });
});

describe('regresiones', () => {
  it('aprobado/editado/ANSWERED → respondida; pendiente+CLOSED_UNANSWERED → pendiente', () => {
    const m = (s: string) => new Map([[1, { status: s } as unknown as AgentResponse]]);
    expect(agentStatusOf(m('aprobado'), { id: 1, status: 'UNANSWERED' })).toBe('respondida');
    expect(agentStatusOf(m('editado'), { id: 1, status: 'ANSWERED' })).toBe('respondida');
    expect(agentStatusOf(new Map(), { id: 1, status: 'ANSWERED' })).toBe('respondida');
    expect(agentStatusOf(m('pendiente'), { id: 1, status: 'CLOSED_UNANSWERED' })).toBe('pendiente');
  });

  it('respeta los bordes del día de dayToIso', () => {
    const xs = [
      q(1, '2026-11-19T23:59:00.000-04:00'),
      q(2, '2026-11-20T00:00:00.000-03:00'),
      q(3, '2026-11-20T23:59:59.999-03:00'),
      q(4, '2026-11-21T00:00:00.000-03:00'),
      q(5, '2026-11-19T22:30:00.000-04:00'),
    ];
    expect(ordenarParaRevisar(xs, { sort: 'asc', desde: dayToIso('2026-11-20'), hasta: dayToIso('2026-11-20', true) }).map((p) => p.id)).toEqual([2, 1, 3]);
  });

  it('fechas inválidas al final, fuera con filtro, sin mutar', () => {
    const xs = [q(1, null as unknown as string), q(2, '2026-01-01T00:00:00Z'), q(3, 'garbage'), q(4, '2026-01-02T00:00:00Z')];
    expect(ordenarParaRevisar(xs, { sort: 'asc' }).map((p) => p.id)).toEqual([2, 4, 1, 3]);
    expect(ordenarParaRevisar(xs, { sort: 'desc', hasta: dayToIso('2026-12-31', true) }).map((p) => p.id)).toEqual([4, 2]);
    expect(xs.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });
});
