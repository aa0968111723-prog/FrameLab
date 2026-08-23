# FrameLab 整合測試

命令層（`src/lib/commands/`）和 `repo.ts` 是唯一的 mutation path。單元測試若只對原始碼做 regex，不會碰到 SQL。整合測試必須真的跑 PGLite。

## 跑測試

```
npm test
```

會跑 `tests/*.test.ts`、`tests/*.test.mjs` 和 `tests/integration/*.test.ts`。
`--import ./tests/register-alias.mjs` 解析 `@/`；`--test-force-exit` 讓 in-memory PGLite 的 WASM 不會卡住 event loop。

只跑整合測試：

```
node --experimental-strip-types --import ./tests/register-alias.mjs --test-force-exit --test tests/integration/*.test.ts
```

## Harness

[`tests/helpers/db.ts`](../tests/helpers/db.ts) 提供：

| 函式 | 作用 |
|---|---|
| `createTestDb()` | 啟動 **in-memory PGLite**，依序套用 `migrations/*.sql`，把 `getSql()` 指到這個實例 |
| `createTestCtx({ userId, scopes, projectScope })` | 鑄造 `CommandContext` |
| `resetDb()` | `TRUNCATE … CASCADE` 所有 public 表（留下 `_migrations`） |
| `q(sql, params)` | 參數化查詢，斷言用這個讀 row，不要只看 `executeTool` 回傳值 |
| `expectedTableCount()` | `migrations/` 裡每個 `create table` + `_migrations` |

禁止：mock `getSql` / `repo` / `executeTool`。禁止用 grep 原始碼字串當行為斷言。

## 加一條新的整合測試

1. 檔案放 `tests/integration/<name>.test.ts`。
2. `before()` 裡呼叫 `createTestDb()`。需要乾淨資料就再 `resetDb()`。
3. 透過 `executeTool(createTestCtx(), "tool_name", args)` 走命令層。
4. 用 `q("select … from <table> where …", [id])` 斷言 **資料庫的實際 row**。
5. 需要隔離時在 `describe` 上傳 `{ concurrency: false }`。跨步驟狀態請寫在同一個 `it`，不要依賴測試檔並行。

範本：

```ts
import { createTestCtx, createTestDb, q, resetDb } from "../helpers/db.ts";
import { executeTool } from "../../src/lib/commands/execute.ts";

describe("my flow", { concurrency: false }, () => {
  before(async () => {
    await createTestDb();
    await resetDb();
  });

  it("writes a real row", async () => {
    const ctx = createTestCtx();
    const r = await executeTool(ctx, "create_project", { name: "demo" });
    const id = (r as { data: { id: string } }).data.id;
    const rows = await q("select name from projects where id = $1", [id]);
    assert.equal(rows[0]?.name, "demo");
  });
});
```

現有主線：[`tests/integration/core-flow.test.ts`](../tests/integration/core-flow.test.ts)
（create_project → create_timeline → ingest_frames → create_inbetween_plan → generate_inbetweens → accept → undo → redo）。中割用 `provider=linear-blend`（快速預覽，不是 AI）。
