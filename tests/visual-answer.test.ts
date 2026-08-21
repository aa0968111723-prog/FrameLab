import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseVisualAnswer,
  visualAnswerAnnotations,
  visualAnswerFromProblem,
} from "../src/lib/domain/visual-answer.ts";
import { parseAnimationCommand } from "../src/lib/domain/animation-command.ts";

describe("visual answer", () => {
  it("parses F105 右手有問題 into jump / hand / neighbors / trail / range", () => {
    const a = parseVisualAnswer("F105 右手有問題", { currentFrame: 12, frameCount: 200 });
    assert.equal(a?.frame, 105);
    assert.deepEqual(a?.neighbors, [104, 106]);
    assert.deepEqual(a?.range, [104, 106]);
    assert.equal(a?.part, "right_hand");
    assert.equal(a?.joint, "right_wrist");
    assert.equal(a?.trailTarget, "right_hand");
    assert.deepEqual(a?.overlays, ["track", "onion", "problems"]);
    const marks = visualAnswerAnnotations(a!, { x: 0.6, y: 0.4, w: 0.2, h: 0.2 });
    assert.ok(marks.some((m) => m.type === "RANGE"));
    assert.ok(marks.some((m) => m.type === "REGION"));
    assert.ok(marks.some((m) => m.type === "POINT"));
  });

  it("does not steal animation commands", () => {
    assert.equal(parseVisualAnswer("F20到F30多補3張"), null);
    assert.equal(parseVisualAnswer("改成一拍二"), null);
    assert.ok(parseAnimationCommand("F20到F30多補3張", { currentFrame: 20, selectedRange: [20, 30] }));
  });

  it("problem click still focuses the right hand trail", () => {
    const a = visualAnswerFromProblem(105, [104, 106], "HAND", 200);
    assert.equal(a.joint, "right_wrist");
    assert.equal(a.trailTarget, "right_hand");
    assert.deepEqual(a.neighbors, [104, 106]);
  });

  it("studio applies visual answer instead of text-only", () => {
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const prompt = fs.readFileSync(path.join(process.cwd(), "src/lib/domain/conversation.ts"), "utf8");
    assert.match(studio, /applyVisualAnswer/);
    assert.match(studio, /setTrailTarget\(answer\.trailTarget\)/);
    assert.match(studio, /setHighlightRange\(answer\.range\)/);
    assert.match(studio, /setOnionSkin/);
    assert.match(studio, /primary: "track"/);
    assert.match(prompt, /Never answer with text only/);
  });
});
