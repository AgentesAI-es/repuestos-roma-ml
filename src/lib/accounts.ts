import { ML_CONNECTION_ID } from 'astro:env/server';
import type { Connection } from './types';

/**
 * La cuenta que se muestra: la pedida (`?connection=`), si no `ML_CONNECTION_ID`,
 * y si ninguna existe, la primera que devuelve la API de ML.
 */
export function resolveConnectionId(connections: Connection[], requested?: number | null): number | undefined {
  const candidatos = [requested, Number(ML_CONNECTION_ID)];
  for (const id of candidatos) {
    if (id && connections.some((c) => c.id === id)) return id;
  }
  return connections[0]?.id;
}

export const connectionName = (c: Connection) => c.label || c.nickname || `Cuenta ${c.user_id}`;
