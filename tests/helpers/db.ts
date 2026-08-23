/**
 * Live PGLite harness. Every helper here talks to a real in-memory Postgres.
 * Do not mock getSql / repo / executeTool.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import {
  getSql,
  installSqlForTests,
  resetSqlSingletonForTests,
  type Sql,
} from "../../src/lib/db.ts";
import { resetRateLimitForTests } from "../../src/lib/domain/rate-limit.ts";
import type { Scope } from "../../src/lib/domain/types.ts";

const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

let pgRef: PGlite | null = null;

const ALL_SCOPES: Scope[] = [
  "READ",
  "ANALYZE",
  "SUGGEST",
  "EDIT",
  "GENERATE",
  "RENDER",
  "ADMIN",
];

export type TestCtx = {
  userId: string;
  source: string;
  caller: string;
  scopes: Scope[];
  projectScope?: string;
  clientId?: string | null;
};

function migrationsDir(): string {
  return path.join(process.cwd(), "migrations");
}

function loadMigrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir())
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(migrationsDir(), name), "utf8") }));
}

/** create table statements in migrations/ plus the _migrations tracker. */
export function expectedTableCount(): number {
  let n = 1;
  for (const file of loadMigrationFiles()) {
    const matches = file.sql.match(/create\s+table/gi);
    n += matches?.length ?? 0;
  }
  return n;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export async function createTestDb(): Promise<{ sql: Sql; tableCount: number }> {
  resetSqlSingletonForTests();
  const { PGlite } = await import("@electric-sql/pglite");
  if (pgRef) {
    await pgRef.close().catch(() => undefined);
    pgRef = null;
  }
  const pg = new PGlite({
    parsers: {
      [OID_INT8]: Number,
      [OID_DATE]: identity,
      [OID_INTERVAL]: identity,
    },
  });
  await pg.waitReady;
  pgRef = pg;
  await pg.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const doneRows = await pg.query<{ name: string }>("select name from _migrations");
  const done = new Set(doneRows.rows.map((r) => r.name));
  for (const file of loadMigrationFiles()) {
    if (done.has(file.name)) continue;
    await pg.transaction(async (tx) => {
      await tx.exec(file.sql);
      await tx.query("insert into _migrations (name) values ($1)", [file.name]);
    });
  }
  const sql: Sql = Object.assign(
    async <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]) => {
      let text = strings[0] ?? "";
      for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
      const result = await pg.query<T>(text, values);
      return result.rows;
    },
    {
      query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        const result = await pg.query<T>(text, params);
        return result.rows;
      },
    },
  ) as Sql;
  installSqlForTests(sql);
  resetRateLimitForTests();
  const tables = await sql.query<{ n: number }>(
    `select count(*)::int as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  return { sql: await getSql(), tableCount: tables[0]?.n ?? 0 };
}

export function createTestCtx(opts: {
  userId?: string;
  scopes?: Scope[];
  projectScope?: string;
  clientId?: string;
} = {}): TestCtx {
  const userId = opts.userId ?? "user_itest";
  return {
    userId,
    source: "test",
    caller: "test:integration",
    scopes: opts.scopes ?? ALL_SCOPES,
    projectScope: opts.projectScope ?? "all",
    clientId: opts.clientId ?? `cli_${userId}`,
  };
}

export async function resetDb(): Promise<void> {
  const sql = await getSql();
  const tables = await sql.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'`,
  );
  for (const row of tables) {
    await sql.query(`truncate table ${quoteIdent(row.tablename)} cascade`);
  }
  resetRateLimitForTests();
}

export async function closeTestDb(): Promise<void> {
  if (pgRef) {
    await pgRef.close().catch(() => undefined);
    pgRef = null;
  }
  resetSqlSingletonForTests();
  resetRateLimitForTests();
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = await getSql();
  return sql.query<T>(text, params);
}
