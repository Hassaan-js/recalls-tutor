import { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { drizzle as drizzleLocal, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleRemote, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as authSchema from './auth-schema';

export interface Database {
  authOrm: PgliteDatabase<typeof authSchema> | PostgresJsDatabase<typeof authSchema>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(run: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function embeddedDatabase(client: PGlite): Database {
  const wrap = (db: Pick<PGlite,'query'|'exec'|'transaction'>): Database => ({
    authOrm: drizzleLocal(db as PGlite, {schema:authSchema}),
    async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) { return (await db.query<T>(sql, params)).rows; },
    async exec(sql) { await db.exec(sql); },
    async transaction(run) { return db.transaction(async tx => run(wrap(tx as unknown as PGlite))); },
    async close() { await client.close(); },
  });
  return wrap(client);
}

function remoteDatabase(url: string): Database {
  const pooled = /pooler|:6543\b|pgbouncer=true/i.test(url);
  const sql = postgres(url, { max: 5, prepare: !pooled, idle_timeout: 20, connect_timeout: 15 });
  function wrap(connection: typeof sql): Database {
    return {
      authOrm: drizzleRemote(connection, {schema:authSchema}),
      async query<T extends Record<string, unknown>>(query: string, params: unknown[] = []) {
        return await connection.unsafe(query, params as never[]) as unknown as T[];
      },
      async exec(query) { await connection.unsafe(query); },
      async transaction(run) { return await sql.begin(async tx => run(wrap(tx as unknown as typeof sql))) as Awaited<ReturnType<typeof run>>; },
      async close() { await sql.end(); },
    };
  }
  return wrap(sql);
}

const globalDb = globalThis as unknown as { recallsDb?: Database };
export function getDatabase(): Database {
  if (globalDb.recallsDb) return globalDb.recallsDb;
  const url = process.env.DATABASE_URL;
  // RECALLS_LOCAL_PRODUCTION_CHECK lets a local production build (Lighthouse, performance checks) read an embedded
  // database. It is never set on a deployed server, where DATABASE_URL stays required.
  if (!url && process.env.NODE_ENV === 'production' && process.env.RECALLS_LOCAL_PRODUCTION_CHECK !== '1') throw new Error('DATABASE_URL is required in production.');
  if (!url) mkdirSync(path.join(process.cwd(), '.local'), {recursive:true});
  // Alternative embedded databases (QA, meeting demo) are limited to the known ignored .local folders.
  const localPath=process.env.RECALLS_LOCAL_DB==='.local/studio-qa'?path.join(process.cwd(),'.local/studio-qa'):process.env.RECALLS_LOCAL_DB==='.local/demo'?path.join(process.cwd(),'.local/demo'):path.join(process.cwd(),'.local/database');
  globalDb.recallsDb = url ? remoteDatabase(url) : embeddedDatabase(new PGlite(localPath));
  return globalDb.recallsDb;
}
