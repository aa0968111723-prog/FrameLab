/**
 * MCP resources/read and a few tools used to skip project_scope + audit.
 * Conversation reads went through a dynamic import; list_projects / get_job /
 * list_audit_logs / cancel_job never called ownProject. A token scoped to
 * project A could still read project B's conversation with no audit row.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function caseBody(src: string, tool: string, until: string): string {
  const idx = src.indexOf(`case "${tool}"`);
  assert.ok(idx >= 0, `${tool} case missing`);
  const end = src.indexOf(`case "${until}"`, idx + 1);
  assert.ok(end > idx, `${tool} end (${until}) missing`);
  return src.slice(idx, end);
}

describe("MCP resources/read goes through executeTool", () => {
  const http = read("src", "lib", "mcp", "http.ts");

  it("conversation resource does not dynamic-import around the gate", () => {
    assert.match(http, /conversations\\\/\(\[/);
    assert.doesNotMatch(
      http,
      /readConversationResource/,
      "resources/read must not call readConversationResource directly — that skips assertToolAllowed, project scope, and audit",
    );
    assert.match(
      http,
      /executeTool\(ctx,\s*"get_conversation"/,
      "framelab://conversations/{id} must run get_conversation via executeTool",
    );
  });

  it("model/status resources either use executeTool or document the bypass", () => {
    for (const uri of ["framelab://models", "framelab://system/status"]) {
      const idx = http.indexOf(uri);
      assert.ok(idx > 0, `${uri} missing`);
      const body = http.slice(idx, idx + 400);
      const usesTool = /executeTool\(/.test(body);
      const documented = /bypass|not tenant|no tenant/i.test(body) || /executeTool\(/.test(body);
      assert.ok(
        usesTool || documented,
        `${uri} must go through executeTool (or sit next to a comment explaining why it cannot)`,
      );
    }
  });
});

describe("project-scoped tools", () => {
  const exec = read("src", "lib", "commands", "execute.ts");
  const ctx = read("src", "lib", "commands", "context-tools.ts");

  it("readConversationResource owns the conversation's project", () => {
    const idx = ctx.indexOf("export async function readConversationResource");
    const body = ctx.slice(idx, ctx.indexOf("export async function", idx + 10) || ctx.length);
    const own = body.indexOf("ownProject(");
    const load = body.indexOf("getConversation(");
    assert.ok(load >= 0 && own > load, "must load the row then ownProject(ctx, conv.project_id)");
    assert.match(body, /ownProject\(ctx,\s*conv\.project_id\)/);
  });

  it("list_projects honours projectScope", () => {
    const body = caseBody(exec, "list_projects", "get_project");
    assert.match(
      body,
      /projectScope|scopedProjectIds/,
      "a token scoped to project A must not list project B",
    );
  });

  it("get_job owns the job's project before returning it", () => {
    const body = caseBody(exec, "get_job", "list_jobs");
    assert.match(
      body,
      /ownProject\(ctx,\s*(job\.project_id|j\.project_id)\)|ownJob\(ctx,/,
      "get_job is keyed by user_id only — a scoped token could read another project's job",
    );
  });

  it("cancel_job owns the job's project before writing", () => {
    const body = caseBody(exec, "cancel_job", "list_mcp_clients");
    assert.match(
      body,
      /ownProject\(ctx,\s*(job\.project_id|j\.project_id)\)|ownJob\(ctx,/,
      "cancel_job is a write: a scoped token must not cancel another project's job",
    );
    const own = body.search(/ownProject|ownJob/);
    const write = body.indexOf("updateJob");
    assert.ok(own >= 0 && own < write, "ownership check must run before updateJob");
  });

  it("list_audit_logs does not dump every project for a scoped token", () => {
    const body = caseBody(exec, "list_audit_logs", "create_sample_project");
    assert.match(
      body,
      /projectScope|scopedProjectIds|project_id/,
      "ADMIN + project_scope=A must not read audit rows for project B",
    );
  });

  it("PERMISSION_DENIED is audited as denied, not a silent error", () => {
    const start = exec.indexOf("export async function executeTool");
    const end = exec.indexOf("async function dispatch(");
    const body = exec.slice(start, end);
    assert.match(
      body,
      /PERMISSION_DENIED[\s\S]{0,120}denied/,
      "executeTool must record status=denied so a blocked conversation read leaves an audit row",
    );
  });
});

describe("project-scoped conversation read (live)", () => {
  it("rejects another project's conversation and writes a denied audit row", async () => {
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
      // already registered / tsx resolves @/ on its own
    }

    const { executeTool, ALL_SCOPES } = await import("../src/lib/commands/execute.ts");
    const repo = await import("../src/lib/framelab/repo.ts");
    const { resetRateLimitForTests } = await import("../src/lib/domain/rate-limit.ts");
    resetRateLimitForTests();

    const userId = "user_scope_test";
    const admin = {
      userId,
      source: "mcp",
      caller: "mcp:test",
      scopes: ALL_SCOPES,
      clientId: "cli_scope_admin",
      projectScope: "all",
    };
    const createdA = await executeTool(admin, "create_project", { name: "Scope A" });
    const createdB = await executeTool(admin, "create_project", { name: "Scope B" });
    assert.equal(createdA.ok, true, JSON.stringify(createdA));
    assert.equal(createdB.ok, true, JSON.stringify(createdB));
    const projectA = (createdA as { data: { id: string } }).data.id;
    const projectB = (createdB as { data: { id: string } }).data.id;

    const convId = "cnv_other_project";
    await repo.insertConversation({
      id: convId,
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

    resetRateLimitForTests();
    const scoped = {
      ...admin,
      projectScope: projectA,
      clientId: "cli_scoped_a",
    };
    const denied = await executeTool(scoped, "get_conversation", { conversationId: convId });
    assert.equal(denied.ok, false);
    assert.equal((denied as { code: string }).code, "PERMISSION_DENIED");

    const logs = (await repo.listAudit(userId, 50)) as Array<{ tool: string; status: string }>;
    const row = logs.find((l) => l.tool === "get_conversation" && l.status === "denied");
    assert.ok(
      row,
      `expected a denied audit row for get_conversation, saw ${JSON.stringify(logs.map((l) => ({ tool: l.tool, status: l.status })))}`,
    );
  });
});
