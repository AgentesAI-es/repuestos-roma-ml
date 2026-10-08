import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { resetEnv, setEnv } from '../../../../test/env';

vi.mock('astro:env/server', () => import('../../../../test/env'));
// Los tests no escriben en la base: el registro se mockea.
vi.mock('../revision', async (original) => ({
  ...(await original<typeof import('../revision')>()),
  registrarEnvio: vi.fn(),
}));

const { ENCABEZADO_REVISION, enviarRespuesta } = await import('./enviar-respuesta');
const { POST } = await import('../../../pages/api/tool-execution');
const { registrarEnvio } = await import('../revision');
const registro = vi.mocked(registrarEnvio);

beforeEach(() => {
  registro.mockResolvedValue({ id: 'fila-1', resultado: 'creada' });
});
afterEach(() => {
  resetEnv();
  vi.restoreAllMocks();
  registro.mockReset();
});

const context = {
  cw_account_id: '3',
  cw_conversation_id: '6459',
  meli_connection_id: '8',
  meli_item_id: 'MLA704095902',
  bot_key: 'clave-del-bot',
  question_id: 'meli_q_13662962403',
};

const mockChatwoot = () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 46816 }));

const cuerpoEnviado = (espia: ReturnType<typeof mockChatwoot>) => {
  const [url, init] = espia.mock.calls[0]!;
  return { url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
};

test('URL por cuenta y conversación, token del bot del contexto', async () => {
  const espia = mockChatwoot();
  await enviarRespuesta.ejecutar({ payload: { respuesta: '  Sí, le va.  ' }, context });
  const { url, headers, body } = cuerpoEnviado(espia);
  expect(url).toBe('https://chat.example.com/api/v1/accounts/3/conversations/6459/messages');
  expect(headers.api_access_token).toBe('clave-del-bot');
  expect(body).toEqual({ content: 'Sí, le va.', message_type: 'outgoing', private: true, content_type: 'text' });
});

test('CHATWOOT_BOT_TOKEN tiene prioridad sobre el bot_key del contexto', async () => {
  setEnv({ CHATWOOT_BOT_TOKEN: 'clave-del-env' });
  const espia = mockChatwoot();
  await enviarRespuesta.ejecutar({ payload: { respuesta: 'x' }, context });
  expect(cuerpoEnviado(espia).headers.api_access_token).toBe('clave-del-env');
});

test('público solo con ML_RESPUESTA_PUBLICA y sin revisión', async () => {
  setEnv({ ML_RESPUESTA_PUBLICA: true });
  let espia = mockChatwoot();
  const publica = await enviarRespuesta.ejecutar({ payload: { respuesta: 'x', revision: false }, context });
  expect(cuerpoEnviado(espia).body.private).toBe(false);
  expect(publica).toMatchObject({ cwMessageId: 46816, enviadoComo: 'respuesta_publica' });
  espia.mockRestore();

  espia = mockChatwoot();
  // El LLM a veces manda el booleano como texto.
  const revision = await enviarRespuesta.ejecutar({ payload: { respuesta: 'x', revision: 'true' }, context });
  expect(cuerpoEnviado(espia).body.private).toBe(true);
  expect(revision).toMatchObject({ enviadoComo: 'nota_privada' });
});

test('con revisión registra: question_id sin prefijo, publicación y mensaje', async () => {
  mockChatwoot();
  const r = await enviarRespuesta.ejecutar({ payload: { respuesta: 'Sí', revision: true }, context });
  expect(registro).toHaveBeenCalledWith({
    questionId: '13662962403',
    publicacionId: 'MLA704095902',
    respuestaPropuesta: 'Sí',
    cwAccountId: 3,
    cwConversationId: 6459,
    cwMessageId: 46816,
    meliConnectionId: 8,
  });
  expect(r).toMatchObject({ registroId: 'fila-1' });
});

test('si falla el registro, el envío igual se informa como hecho (no reintentar)', async () => {
  mockChatwoot();
  registro.mockRejectedValue(new Error('base caída'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const r = await enviarRespuesta.ejecutar({ payload: { respuesta: 'Sí', revision: true }, context });
  expect(r).toMatchObject({ cwMessageId: 46816, registroId: null });
  expect(error).toHaveBeenCalled();
});

test('pregunta ya revisada: la nota sale, la decisión no se toca y se le avisa al agente', async () => {
  const espia = mockChatwoot();
  registro.mockResolvedValue({ id: 'fila-1', resultado: 'ya_resuelta', status: 'aprobado', revisadoPor: 'Ana' });
  const r = await enviarRespuesta.ejecutar({ payload: { respuesta: 'Sí', revision: true }, context });
  expect(espia).toHaveBeenCalledTimes(1);
  expect(r).toMatchObject({ registroId: 'fila-1', registro: 'ya_resuelta' });
  expect(r.motivo).toContain('ya fue revisada (aprobado por Ana)');
});

test('sin revisión se envía pero no se registra', async () => {
  mockChatwoot();
  const r = await enviarRespuesta.ejecutar({ payload: { respuesta: 'Sí', revision: false }, context });
  expect(r).toMatchObject({ cwMessageId: 46816, registroId: null });
  expect(registro).not.toHaveBeenCalled();
});

test('acepta las claves viejas sin prefijo mientras se actualiza el bot', async () => {
  const espia = mockChatwoot();
  const { cw_account_id, cw_conversation_id, ...resto } = context;
  await enviarRespuesta.ejecutar({
    payload: { respuesta: 'x' },
    context: { ...resto, account_id: cw_account_id, conversation_id: cw_conversation_id },
  });
  expect(cuerpoEnviado(espia).url).toBe('https://chat.example.com/api/v1/accounts/3/conversations/6459/messages');
});

test('meli_connection_id vacío (template sin valor) se registra como null y no frena', async () => {
  mockChatwoot();
  await enviarRespuesta.ejecutar({ payload: { respuesta: 'x', revision: true }, context: { ...context, meli_connection_id: '' } });
  expect(registro).toHaveBeenCalledWith(expect.objectContaining({ meliConnectionId: null }));
});

test('con revisión la nota lleva el encabezado de pendiente; el registro guarda el texto limpio', async () => {
  const espia = mockChatwoot();
  await enviarRespuesta.ejecutar({ payload: { respuesta: 'Sí, le va.', revision: true }, context });
  expect(cuerpoEnviado(espia).body.content).toBe(`${ENCABEZADO_REVISION}\n\nSí, le va.`);
  expect(registro).toHaveBeenCalledWith(expect.objectContaining({ respuestaPropuesta: 'Sí, le va.' }));
});

// --- El endpoint ---

const post = (body: unknown, headers: Record<string, string> = { 'x-api-key': 'clave-tools' }, query = '') => {
  const url = new URL(`https://panel.example.com/api/tool-execution${query}`);
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return POST({ request, url } as Parameters<typeof POST>[0]) as Promise<Response>;
};

test('POST enruta por tool y devuelve el resultado', async () => {
  mockChatwoot();
  const r = await post({ tool: 'enviar_respuesta', payload: { respuesta: 'Sí' }, context });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ ok: true, tool: 'enviar_respuesta', resultado: { cwMessageId: 46816 } });
});

test('POST acepta la key por query y `arguments` como alias de `payload`', async () => {
  mockChatwoot();
  const r = await post({ tool: 'enviar_respuesta', arguments: { respuesta: 'Sí' }, context }, {}, '?apiKey=clave-tools');
  expect(r.status).toBe(200);
});

test('POST sin key o con otra: 401; sin TOOL_API_KEY configurada: 503', async () => {
  const espia = vi.spyOn(globalThis, 'fetch');
  const body = { tool: 'enviar_respuesta', payload: { respuesta: 'Sí' }, context };
  expect((await post(body, {})).status).toBe(401);
  expect((await post(body, { 'x-api-key': 'otra' })).status).toBe(401);
  setEnv({ TOOL_API_KEY: undefined });
  expect((await post(body)).status).toBe(503);
  expect(espia).not.toHaveBeenCalled();
});

test('POST con tool desconocida o argumentos inválidos no llama a Chatwoot', async () => {
  const espia = vi.spyOn(globalThis, 'fetch');

  const desconocida = await post({ tool: 'borrar_todo', payload: {}, context });
  expect(desconocida.status).toBe(400);
  expect(await desconocida.json()).toMatchObject({ code: 'TOOL_DESCONOCIDA' });

  const sinTexto = await post({ tool: 'enviar_respuesta', payload: { respuesta: '   ' }, context });
  expect(sinTexto.status).toBe(400);
  expect(await sinTexto.json()).toMatchObject({ detalles: [{ campo: 'respuesta' }] });

  const sinConversacion = await post({ tool: 'enviar_respuesta', payload: { respuesta: 'x' }, context: {} });
  expect(sinConversacion.status).toBe(400);

  expect(espia).not.toHaveBeenCalled();
});

test('POST con Chatwoot caído: 502 con el motivo, para que el agente lo vea', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('conversación no encontrada', { status: 404 }));
  const r = await post({ tool: 'enviar_respuesta', payload: { respuesta: 'Sí' }, context });
  expect(r.status).toBe(502);
  expect(await r.json()).toMatchObject({ code: 'CHATWOOT_ERROR', error: expect.stringContaining('404') });
});
