/**
 * MCP resources/read and a few tools used to skip project_scope + audit.
 * These used to be regex-on-source-text checks (which contradicted
 * mcp-contract.test.mjs and never executed the tools). They now call
 * executeTool against a live PGlite.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

describe("MCP project-scope (live)", () => {
  let executeTool: typeof import("../src/lib/commands/execute.ts").executeTool;
  let ALL_SCOPES: typeof import("../src/lib/commands/execute.ts").ALL_SCOPES;
  let repo: typeof import("../src/lib/framelab/repo.ts");
  let resetRateLimitForTests: typeof import("../src/lib/domain/rate-limit.ts").resetRateLimitForTests;

  const userId = "user_scope_live";
  const admin = {
    userId,
    source: "mcp" as const,
    caller: "mcp:scope-live",
    scopes: [] as string[],
    clientId: "cli_scope_live_admin",
    projectScope: "all",
  };
  let projectA = "";
  let projectB = "";
  let convB = "";
  let jobB = "";

  before(async () => {
    const { register } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-scope-"));
    process.env.PGLITE_DATA_DIR = dataDir;
    try {
      register(pathToFileURL(path.join(process.cwd(), "tests", "alias-loader.mjs")).href);
    } catch {
      /* tsx / already registered */
    }

    const exec = await import("../src/lib/commands/execute.ts");
    executeTool = exec.executeTool;
    ALL_SCOPES = exec.ALL_SCOPES;
    repo = await import("../src/lib/framelab/repo.ts");
    ({ resetRateLimitForTests } = await import("../src/lib/domain/rate-limit.ts"));
    admin.scopes = ALL_SCOPES;
    resetRateLimitForTests();

    const createdA = await executeTool(admin, "create_project", { name: "Scope A" });
    const createdB = await executeTool(admin, "create_project", { name: "Scope B" });
    assert.equal(createdA.ok, true, JSON.stringify(createdA));
    assert.equal(createdB.ok, true, JSON.stringify(createdB));
    projectA = (createdA as { data: { id: string } }).data.id;
    projectB = (createdB as { data: { id: string } }).data.id;

    convB = "cnv_other_project_live";
    await repo.insertConversation({
      id: convB,
      userId,
      projectId: projectB,
      timelineId: null,
      title: "secret",
      provider: "grok",
      mode: "ask",
      contextLocked: false,
      lockedSnapshotJson: "{}",
      frameStart: null,
      frameEnd: null,
    });

    const job = await repo.insertJob({
      userId,
      projectId: projectB,
      type: "CONSISTENCY_ANALYSIS",
      payload: { secret: true },
    });
    jobB = job.id;

    await repo.insertAudit({
      userId,
      clientId: "cli_b_seed",
      tool: "seed_project_b_audit",
      caller: "test",
      scopeUsed: "ADMIN",
      args: { projectId: projectB },
      projectId: projectB,
      status: "ok",
      durationMs: 1,
    });
    resetRateLimitForTests();
  });

  function scopedA(clientId: string) {
    return {
      ...admin,
      projectScope: projectA,
      clientId,
    };
  }

  it("get_conversation on another project is PERMISSION_DENIED and audited as denied", async () => {
    resetRateLimitForTests();
    const denied = await executeTool(scopedA("cli_scope_conv"), "get_conversation", {
      conversationId: convB,
    });
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.equal((denied as { code: string }).code, "PERMISSION_DENIED", JSON.stringify(denied));

    const logs = (await repo.listAudit(userId, 50)) as Array<{ tool: string; status: string }>;
    const row = logs.find((l) => l.tool === "get_conversation" && l.status === "denied");
    assert.ok(
      row,
      `expected a denied audit row for get_conversation, saw ${JSON.stringify(logs.map((l) => ({ tool: l.tool, status: l.status })))}`,
    );
  });

  it("list_projects honours projectScope", async () => {
    resetRateLimitForTests();
    const listed = await executeTool(scopedA("cli_scope_list"), "list_projects", {});
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const ids = ((listed as { data: Array<{ id: string }> }).data ?? []).map((p) => p.id);
    assert.ok(ids.includes(projectA), `scope A missing A: ${ids.join(",")}`);
    assert.equal(ids.includes(projectB), false, "a token scoped to project A must not list project B");
  });

  it("get_job owns the job's project before returning it", async () => {
    resetRateLimitForTests();
    const denied = await executeTool(scopedA("cli_scope_job"), "get_job", { jobId: jobB });
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.match((denied as { code: string }).code, /PERMISSION_DENIED|PROJECT_NOT_FOUND/);
  });

  it("cancel_job owns the job's project before writing", async () => {
    resetRateLimitForTests();
    const denied = await executeTool(scopedA("cli_scope_cancel"), "cancel_job", { jobId: jobB });
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.match((denied as { code: string }).code, /PERMISSION_DENIED|PROJECT_NOT_FOUND/);
    const still = await repo.getJob(userId, jobB);
    assert.ok(still, "job row must still exist");
    assert.notEqual(still.state, "cancelled");
  });

  it("list_audit_logs does not dump every project for a scoped token", async () => {
    resetRateLimitForTests();
    const listed = await executeTool(scopedA("cli_scope_audit"), "list_audit_logs", { limit: 80 });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const rows = (listed as { data: Array<{ tool?: string; project_id?: string | null }> }).data ?? [];
    assert.equal(
      rows.some((r) => r.tool === "seed_project_b_audit" || r.project_id === projectB),
      false,
      "ADMIN + project_scope=A must not read audit rows for project B",
    );
  });
});
