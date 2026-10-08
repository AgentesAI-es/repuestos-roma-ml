import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearCache } from './cache';

const opciones = { fresco: 1000, maxViejo: 10_000, max: 2 };

describe('crearCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fresco: no vuelve a cargar', async () => {
    const cache = crearCache<number>(opciones);
    const cargador = vi.fn().mockResolvedValue(1);
    await cache.obtener('a', cargador);
    vi.advanceTimersByTime(999);
    expect(await cache.obtener('a', cargador)).toBe(1);
    expect(cargador).toHaveBeenCalledTimes(1);
  });

  it('viejo: devuelve lo guardado al instante y recarga de fondo', async () => {
    const cache = crearCache<number>(opciones);
    await cache.obtener('a', () => Promise.resolve(1));
    vi.advanceTimersByTime(1000);
    const cargador = vi.fn().mockResolvedValue(2);
    expect(await cache.obtener('a', cargador)).toBe(1);
    expect(cargador).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => expect(await cache.obtener('a', cargador)).toBe(2));
  });

  it('demasiado viejo: espera la carga', async () => {
    const cache = crearCache<number>(opciones);
    await cache.obtener('a', () => Promise.resolve(1));
    vi.advanceTimersByTime(10_000);
    expect(await cache.obtener('a', () => Promise.resolve(2))).toBe(2);
  });

  it('forzar: ignora lo guardado', async () => {
    const cache = crearCache<number>(opciones);
    await cache.obtener('a', () => Promise.resolve(1));
    expect(await cache.obtener('a', () => Promise.resolve(2), { forzar: true })).toBe(2);
  });

  it('un solo pedido por clave a la vez', async () => {
    const cache = crearCache<number>(opciones);
    const cargador = vi.fn().mockResolvedValue(1);
    await Promise.all([cache.obtener('a', cargador), cache.obtener('a', cargador)]);
    expect(cargador).toHaveBeenCalledTimes(1);
  });

  it('un error no se guarda; si falla un refresco de fondo queda el valor anterior', async () => {
    const cache = crearCache<number>(opciones);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(cache.obtener('a', () => Promise.reject(new Error('ML caída')))).rejects.toThrow('ML caída');
    await cache.obtener('a', () => Promise.resolve(1));
    vi.advanceTimersByTime(1000);
    expect(await cache.obtener('a', () => Promise.reject(new Error('ML caída')))).toBe(1);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(await cache.obtener('a', () => Promise.resolve(3))).toBe(1);
  });

  it('pasado el máximo se va la menos usada', async () => {
    const cache = crearCache<number>(opciones);
    await cache.obtener('a', () => Promise.resolve(1));
    await cache.obtener('b', () => Promise.resolve(2));
    await cache.obtener('a', () => Promise.resolve(0)); // "a" pasa a ser la más usada
    await cache.obtener('c', () => Promise.resolve(3));
    expect(await cache.obtener('a', () => Promise.resolve(9))).toBe(1);
    expect(await cache.obtener('b', () => Promise.resolve(9))).toBe(9);
  });
});
