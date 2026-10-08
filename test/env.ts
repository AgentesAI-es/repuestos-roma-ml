/**
 * `astro:env/server` para los tests. Cada archivo de test hace
 *
 *   vi.mock('astro:env/server', () => import('<ruta>/test/env'))
 *
 * y cambia las variables con `setEnv({ ... })`; `resetEnv()` vuelve a estos
 * valores. Son `let` exportados: los módulos que las importan por nombre ven
 * el cambio (bindings vivos de ESM).
 */
/** Postgres descartable para los tests de integración (sin @types/node en el proyecto). */
export const TEST_DATABASE_URL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
  .TEST_DATABASE_URL;

export let DATABASE_URL: string | undefined;
export let TOOL_API_KEY: string | undefined;
export let CHATWOOT_URL: string | undefined;
export let CHATWOOT_BOT_TOKEN: string | undefined;
export let CHATWOOT_TIMEOUT_MS: number;
export let ML_RESPUESTA_PUBLICA: boolean;
export let ML_API_URL: string;
export let ML_API_TOKEN: string | undefined;

interface Env {
  DATABASE_URL?: string;
  TOOL_API_KEY?: string;
  CHATWOOT_URL?: string;
  CHATWOOT_BOT_TOKEN?: string;
  CHATWOOT_TIMEOUT_MS?: number;
  ML_RESPUESTA_PUBLICA?: boolean;
}

export function setEnv(v: Env) {
  if ('DATABASE_URL' in v) DATABASE_URL = v.DATABASE_URL;
  if ('TOOL_API_KEY' in v) TOOL_API_KEY = v.TOOL_API_KEY;
  if ('CHATWOOT_URL' in v) CHATWOOT_URL = v.CHATWOOT_URL;
  if ('CHATWOOT_BOT_TOKEN' in v) CHATWOOT_BOT_TOKEN = v.CHATWOOT_BOT_TOKEN;
  if ('CHATWOOT_TIMEOUT_MS' in v) CHATWOOT_TIMEOUT_MS = v.CHATWOOT_TIMEOUT_MS!;
  if ('ML_RESPUESTA_PUBLICA' in v) ML_RESPUESTA_PUBLICA = v.ML_RESPUESTA_PUBLICA!;
}

export function resetEnv() {
  DATABASE_URL = TEST_DATABASE_URL;
  TOOL_API_KEY = 'clave-tools';
  CHATWOOT_URL = 'https://chat.example.com';
  CHATWOOT_BOT_TOKEN = undefined;
  CHATWOOT_TIMEOUT_MS = 8000;
  ML_RESPUESTA_PUBLICA = false;
  ML_API_URL = 'https://ml.example.com';
  ML_API_TOKEN = undefined;
}

resetEnv();
