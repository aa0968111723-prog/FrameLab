/**
 * annotate_frame / highlight_region / highlight_frame_range must work with only
 * sessionId (conversation runtime never sends projectId). A foreign sessionId
 * must still be rejected.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fl-ann-"));
process.env.PGLITE_DATA_DIR = dataDir;
try {
  register(pathToFileURL(path.join(process.cwd(), "tests", "alias-loader.mjs")).href);
} catch {
  /* tsx */
}

const { executeTool, ALL_SCOPES } = await import("../src/lib/commands/execute.ts");
const repo = await import("../src/lib/framelab/repo.ts");
const { resetRateLimitForTests } = await import("../src/lib/domain/rate-limit.ts");

const owner = {
  userId: "user_ann_owner",
  source: "mcp" as const,
  caller: "mcp:ann",
  scopes: ALL_SCOPES,
  clientId: "cli_ann_owner",
  projectScope: "all",
};
const stranger = {
  userId: "user_ann_other",
  source: "mcp" as const,
  caller: "mcp:ann-other",
  scopes: ALL_SCOPES,
  clientId: "cli_ann_other",
  projectScope: "all",
};

let sessionId = "";
let foreignSessionId = "";
let projectId = "";

before(async () => {
  resetRateLimitForTests();
  const created = await executeTool(owner, "create_project", { name: "Ann Owner" });
  assert.equal(created.ok, true, JSON.stringify(created));
  projectId = (created as { data: { id: string } }).data.id;
  sessionId = "ses_ann_owner";
  await repo.upsertWorkspaceSession({ id: sessionId, userId: owner.userId, projectId });

  const other = await executeTool(stranger, "create_project", { name: "Ann Other" });
  assert.equal(other.ok, true, JSON.stringify(other));
  const otherProject = (other as { data: { id: string } }).data.id;
  foreignSessionId = "ses_ann_foreign";
  await repo.upsertWorkspaceSession({
    id: foreignSessionId,
    userId: stranger.userId,
    projectId: otherProject,
  });
  resetRateLimitForTests();
});

const TOOLS = [
  { tool: "annotate_frame", args: { sessionId, frameNumber: 12, label: "mark" } },
  { tool: "highlight_region", args: { sessionId, frameNumber: 12, x: 0.2, y: 0.2, w: 0.3, h: 0.3 } },
  { tool: "highlight_frame_range", args: { sessionId, startFrame: 10, endFrame: 20 } },
] as const;

describe("catalog + REST declare the lookup keys", () => {
  it("catalog lists projectId, sessionId, timelineId on the three write tools", () => {
    const cat = fs.readFileSync(path.join(process.cwd(), "src", "lib", "mcp", "catalog.ts"), "utf8");
    for (const name of ["annotate_frame", "highlight_region", "highlight_frame_range"]) {
      const idx = cat.indexOf(`tool("${name}"`);
      assert.ok(idx >= 0, `${name} missing from catalog`);
      const next = cat.indexOf("tool(\"", idx + 8);
      const body = cat.slice(idx, next > 0 ? next : undefined);
      assert.match(body, /projectId:\s*str/, `${name} schema must declare projectId`);
      assert.match(body, /sessionId:\s*str/, `${name} schema must declare sessionId`);
      assert.match(body, /timelineId:\s*str/, `${name} schema must declare timelineId`);
    }
  });

  it("rest-map forwards projectId/sessionId/timelineId instead of args: {}", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "framelab", "rest-map.ts"), "utf8");
    for (const name of ["annotate_frame", "highlight_region", "highlight_frame_range"]) {
      const idx = src.indexOf(`tool: "${name}"`);
      assert.ok(idx >= 0, `${name} REST mapping missing`);
      const body = src.slice(idx, idx + 280);
      assert.match(body, /projectId:\s*query\.projectId/, `${name} must map query.projectId`);
      assert.match(body, /sessionId:\s*query\.sessionId/, `${name} must map query.sessionId`);
      assert.match(body, /timelineId:\s*query\.timelineId/, `${name} must map query.timelineId`);
    }
  });
});

describe("visual annotation writes with sessionId only", () => {
  for (const spec of TOOLS) {
    it(`${spec.tool} succeeds with only sessionId and rejects a foreign session`, async () => {
      resetRateLimitForTests();
      const ok = await executeTool(owner, spec.tool, { ...spec.args, sessionId });
      assert.equal(ok.ok, true, `${spec.tool} with sessionId should write: ${JSON.stringify(ok)}`);
      const rows = await repo.listVisualAnnotations({ userId: owner.userId, sessionId });
      assert.ok(rows.length >= 1, `${spec.tool} must persist a row`);

      resetRateLimitForTests();
      const denied = await executeTool(owner, spec.tool, { ...spec.args, sessionId: foreignSessionId });
      assert.equal(denied.ok, false, `${spec.tool} must reject another user's sessionId`);
      assert.match((denied as { code: string }).code, /NOT_FOUND|PERMISSION_DENIED/);
    });
  }
});
