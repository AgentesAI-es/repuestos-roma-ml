import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetEnv, setEnv } from '../../../test/env';

vi.mock('astro:env/server', () => import('../../../test/env'));

const { getArticuloDePublicacion } = await import('./articulo-api');

const publicacion = {
  id: 'MLA704095902',
  cuenta: 'ROMA2',
  listaCodigo: 'LM',
  esFull: false,
  articulo: {
    codigo: '01MI0043901',
    descripcion: 'AMORTIGUADOR DELANTERO MONROE',
    descripcionAdicional: '2.0 16V',
    observaciones: null,
    codigoProveedor: 'MI43901',
    equivalencias: null,
    tipo: 'AMORTIGUADOR DELANTERO',
    marca: 'MONROE',
    vehiculo: 'FIAT',
    stockTotal: 3,
    porDeposito: { DEP: 1, ML: 2 },
    precio: 114442,
    activo: true,
  },
  formatted: '...',
};

const fetchMock = vi.fn();

beforeEach(() => {
  resetEnv();
  setEnv({ REPUESTOS_ROMA_API_URL: 'https://roma.example.com', REPUESTOS_ROMA_API_KEY: 'clave-roma' });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const responder = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

test('pide la publicación por item_id con la api key y devuelve el artículo', async () => {
  responder(200, publicacion);
  const r = await getArticuloDePublicacion('MLA704095902');
  expect(r).toEqual({ estado: 'ok', publicacion });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe('https://roma.example.com/v1/publicaciones-ml/MLA704095902');
  expect(init.headers['x-api-key']).toBe('clave-roma');
});

test('404: la publicación no está vinculada a un artículo del ERP', async () => {
  responder(404, { error: 'La publicación MLA1 no está en el ERP', code: 'NOT_FOUND' });
  expect(await getArticuloDePublicacion('MLA1')).toEqual({ estado: 'no_vinculado' });
});

test('otro error de la API: devuelve el mensaje, no tira', async () => {
  responder(401, { error: 'API key inválida o ausente', code: 'UNAUTHORIZED' });
  expect(await getArticuloDePublicacion('MLA1')).toEqual({ estado: 'error', mensaje: 'API key inválida o ausente' });
});

test('API caída: error de conexión, no tira', async () => {
  fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
  const r = await getArticuloDePublicacion('MLA1');
  expect(r.estado).toBe('error');
  expect(r.estado === 'error' && r.mensaje).toContain('ECONNREFUSED');
});

test('sin URL configurada: no llama a la API', async () => {
  setEnv({ REPUESTOS_ROMA_API_URL: undefined });
  expect(await getArticuloDePublicacion('MLA1')).toEqual({ estado: 'sin_configurar' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('sin item_id: no vinculado, sin llamar a la API', async () => {
  expect(await getArticuloDePublicacion(null)).toEqual({ estado: 'no_vinculado' });
  expect(fetchMock).not.toHaveBeenCalled();
});
