import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { closeTestDb, createTestDb, expectedTableCount, q, resetDb } from "../helpers/db.ts";

describe("integration harness", () => {
  before(async () => {
    const { tableCount } = await createTestDb();
    assert.equal(
      tableCount,
      expectedTableCount(),
      `migrations did not all apply: public tables=${tableCount} expected=${expectedTableCount()}`,
    );
  });

  after(async () => {
    await resetDb();
    await closeTestDb();
  });

  it("information_schema table count matches every create table in migrations/", async () => {
    const applied = await q<{ name: string }>("select name from _migrations order by name");
    const names = applied.map((r) => r.name);
    assert.ok(names.includes("0001_auth.sql"));
    assert.ok(names.includes("0016_sam2.sql"));
    assert.equal(names.length, 16, `expected 16 migration files, got ${names.join(",")}`);
  });

  it("resetDb truncates rows but keeps schema", async () => {
    await q(`insert into projects (id, user_id, name, description, fps, width, height, created_at, updated_at)
      values ('prj_tmp', 'u', 'tmp', '', 24, 8, 8, now(), now())`);
    const beforeRows = await q<{ n: number }>("select count(*)::int as n from projects");
    assert.equal(beforeRows[0]?.n, 1);
    await resetDb();
    const afterRows = await q<{ n: number }>("select count(*)::int as n from projects");
    assert.equal(afterRows[0]?.n, 0);
    const still = await q<{ n: number }>(
      `select count(*)::int as n from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    assert.equal(still[0]?.n, expectedTableCount());
  });
});
