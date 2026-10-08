/**
 * Postgres propio del panel: la cola de revisión (`respuesta_agente`).
 *
 * Una conexión perezosa: el panel arranca y muestra las preguntas de ML
 * aunque la base no esté configurada o no responda. Las migraciones se aplican
 * solas en el primer uso, dentro de un advisory lock (dos procesos arrancando
 * a la vez no las corren dos veces), y quedan anotadas en `_migraciones`.
 *
 * Una migración nueva se agrega al final de MIGRACIONES; nunca se edita una
 * ya aplicada.
 */
import postgres from 'postgres';
import { DATABASE_URL } from 'astro:env/server';

export type Sql = postgres.Sql;

const MIGRACIONES: { nombre: string; sql: string }[] = [
  {
    nombre: '0001_respuesta_agente',
    sql: `
      CREATE TYPE estado_revision AS ENUM ('pendiente', 'aprobado', 'editado');

      CREATE TABLE respuesta_agente (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        creado_en           timestamptz NOT NULL DEFAULT now(),
        -- La última vez que el agente volvió a proponer (null si nunca).
        actualizado_en      timestamptz,
        -- ID de la pregunta de ML, solo dígitos. Texto: no entra en un int.
        -- Única: una fila por pregunta (ver registrarEnvio).
        question_id         varchar(20) UNIQUE,
        publicacion_id      varchar(50),
        -- Lo que propuso el agente. No se toca nunca.
        respuesta_propuesta text NOT NULL,
        -- null mientras está pendiente; la propuesta si se aprobó, el texto corregido si se editó.
        respuesta_enviada   text,
        status              estado_revision NOT NULL DEFAULT 'pendiente',
        -- Chatwoot: la nota que dejó el agente, no el mensaje del comprador.
        cw_account_id       integer,
        cw_conversation_id  integer,
        cw_message_id       integer,
        -- La cuenta de ML (conexión de la API de ML).
        meli_connection_id  integer,
        revisado_por        text,
        revisado_en         timestamptz
      );

      CREATE INDEX respuesta_agente_cuenta_status_idx
        ON respuesta_agente (meli_connection_id, status, creado_en DESC);
      CREATE INDEX respuesta_agente_publicacion_idx
        ON respuesta_agente (publicacion_id, creado_en DESC);
    `,
  },
];

let cliente: Sql | null = null;
let migrado: Promise<void> | null = null;

export const dbConfigurada = () => Boolean(DATABASE_URL);

/** El cliente, con las migraciones ya aplicadas. Tira si no hay `DATABASE_URL`. */
export async function db(): Promise<Sql> {
  if (!DATABASE_URL) throw new Error('DATABASE_URL no configurada');
  cliente ??= postgres(DATABASE_URL, { max: 5, onnotice: () => {} });
  // Si falla (base caída al arrancar), el próximo uso reintenta.
  migrado ??= migrar(cliente).catch((err) => {
    migrado = null;
    throw err;
  });
  await migrado;
  return cliente;
}

async function migrar(sql: Sql) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(727274)`;
    await tx`CREATE TABLE IF NOT EXISTS _migraciones (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())`;
    const hechas = new Set((await tx<{ nombre: string }[]>`SELECT nombre FROM _migraciones`).map((m) => m.nombre));
    for (const m of MIGRACIONES) {
      if (hechas.has(m.nombre)) continue;
      await tx.unsafe(m.sql);
      await tx`INSERT INTO _migraciones (nombre) VALUES (${m.nombre})`;
      console.log(`[db] migración aplicada: ${m.nombre}`);
    }
  });
}
