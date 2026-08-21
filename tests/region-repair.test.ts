import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  BlendRegionRepair,
  buildRegionRepairPipeline,
  isAiRegionRepair,
  isNeighborhoodPreview,
  maskFromSelection,
  maskToPixels,
  neighborhoodPreviewNote,
  regionRepairUnavailableMessage,
} from "../src/lib/domain/region-repair.ts";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { MCP_TOOLS } from "../src/lib/mcp/catalog.ts";

describe("region repair pipeline", () => {
  it("walks 選區 → 遮罩 → 時間脈絡 → 候選 → 前後比較", () => {
    const p = buildRegionRepairPipeline({
      frameNumber: 10,
      selection: { x: 8, y: 8, w: 40, h: 30 },
      frameNumbers: [8, 9, 10, 11, 12],
      providerId: "wan",
      providerAvailable: false,
    });
    assert.deepEqual(
      p.stages.map((s) => s.id),
      ["selection", "mask", "temporal", "candidate", "before_after"],
    );
    assert.equal(p.mask?.source, "rectangle");
    assert.deepEqual(p.temporal.before, [8, 9]);
    assert.deepEqual(p.temporal.after, [11, 12]);
    assert.equal(p.current, "candidate");
    assert.equal(p.available, false);
    assert.equal(p.ai, false);
    assert.match(p.note, /不是 AI 修復/);
  });

  it("treats SAM 2 contour as the mask, not a bbox stub", () => {
    const p = buildRegionRepairPipeline({
      frameNumber: 3,
      mask: {
        frame: 3,
        x: 0.2,
        y: 0.1,
        w: 0.3,
        h: 0.4,
        contour: [
          [0.2, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ],
        source: "sam2",
      },
      frameNumbers: [2, 3, 4],
      providerAvailable: false,
    });
    assert.equal(p.mask?.source, "sam2");
    assert.ok((p.mask?.contour?.length ?? 0) >= 3);
    assert.equal(p.stages.find((s) => s.id === "mask")?.done, true);
  });

  it("never calls bbox blend AI repair", () => {
    assert.equal(isAiRegionRepair("blend-region"), false);
    assert.equal(isAiRegionRepair("neighborhood-preview"), false);
    assert.equal(isAiRegionRepair("wan"), true);
    assert.equal(isNeighborhoodPreview("blend"), true);
    assert.equal(isNeighborhoodPreview("generative"), false);
    assert.match(neighborhoodPreviewNote(), /不是 AI 修復/);
    assert.match(regionRepairUnavailableMessage(), /尚未設定/);
    const blend = new BlendRegionRepair();
    assert.equal(blend.available, false);
  });

  it("converts normalized SAM 2 boxes to pixels", () => {
    const px = maskToPixels({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 }, 200, 100);
    assert.equal(px.x, 50);
    assert.equal(px.y, 50);
    assert.equal(px.w, 20);
    assert.equal(px.h, 20);
    const box = maskFromSelection(4, { x: 10, y: 10, w: 8, h: 8 });
    assert.equal(box?.source, "rectangle");
  });
});

describe("region repair command contract", () => {
  it("default is generative; preview is 快速預覽; Wan is unavailable", () => {
    const cmd = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/region-repair-tools.ts"), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const catalog = fs.readFileSync(path.join(process.cwd(), "src/lib/mcp/catalog.ts"), "utf8");
    const providers = fs.readFileSync(path.join(process.cwd(), "src/lib/ai/providers.ts"), "utf8");
    assert.match(cmd, /method \?\? "generative"/);
    assert.match(cmd, /PROVIDER_NOT_AVAILABLE/);
    assert.match(cmd, /neighborhood-preview/);
    assert.match(cmd, /insertCandidate/);
    assert.doesNotMatch(cmd, /frame_type: "REPAIRED"/);
    assert.match(exec, /repairRegionCmd/);
    assert.match(studio, /startRegionRepair\("generative"\)/);
    assert.doesNotMatch(studio, /startRegionRepair\("blend"\)/);
    assert.match(studio, /生成修復尚未設定/);
    assert.match(catalog, /never bbox-blend as AI/);
    assert.match(providers, /export function getGenerativeRepair/);
    assert.match(providers, /return wan/);
    assert.equal(TOOL_SCOPES.regenerate_region, "GENERATE");
    assert.ok(MCP_TOOLS.some((t) => t.name === "regenerate_region"));
  });

  it("BlendRegionRepair refuses to impersonate AI", async () => {
    const r = await new BlendRegionRepair().repair_region({
      frames: [1],
      masks: [],
      references: [],
      constraints: [],
      temporal_context: { before: 1, after: 1 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "PROVIDER_NOT_AVAILABLE");
  });
});
