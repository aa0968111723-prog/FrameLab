import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseAnimationCommand } from "../src/lib/domain/animation-command.ts";
import { isInbetweenRequest, parseAnimationIntent } from "../src/lib/domain/animation-intent.ts";

const ctx = {
  currentFrame: 12,
  currentFrameId: "frm-12",
  timelineId: "tl-1",
  selectedRange: [20, 30] as [number, number],
};

describe("animation command parser", () => {
  it("parses F20到F30多補3張", () => {
    const cmd = parseAnimationCommand("F20到F30多補3張", ctx);
    assert.equal(cmd?.kind, "add_inbetweens");
    assert.equal(cmd?.tool, "generate_inbetweens");
    assert.equal(cmd?.start, 20);
    assert.equal(cmd?.end, 30);
    assert.equal(cmd?.count, 3);
    assert.equal(cmd?.needsConfirm, true);
    assert.equal(cmd?.args.confirmed, false);
    assert.equal(isInbetweenRequest("F20到F30多補3張"), true);
    const intent = parseAnimationIntent("F20到F30多補3張");
    assert.equal(intent.count, 3);
    assert.equal(intent.start_frame, 20);
    assert.equal(intent.end_frame, 30);
  });

  it("parses F40停兩格", () => {
    const cmd = parseAnimationCommand("F40停兩格", ctx);
    assert.equal(cmd?.kind, "hold_frame");
    assert.equal(cmd?.tool, "hold_frame");
    assert.equal(cmd?.frame, 40);
    assert.equal(cmd?.exposure, 2);
    assert.equal(cmd?.needsConfirm, true);
  });

  it("parses 這張設成關鍵影格", () => {
    const cmd = parseAnimationCommand("這張設成關鍵影格", ctx);
    assert.equal(cmd?.kind, "set_keyframe");
    assert.equal(cmd?.tool, "create_keyframe");
    assert.equal(cmd?.frame, 12);
    assert.equal(cmd?.args.frameId, "frm-12");
    assert.equal(cmd?.needsConfirm, true);
  });

  it("parses 改成一拍二", () => {
    const cmd = parseAnimationCommand("改成一拍二", ctx);
    assert.equal(cmd?.kind, "set_exposure");
    assert.equal(cmd?.tool, "set_frame_exposure");
    assert.equal(cmd?.exposure, 2);
    assert.equal(cmd?.frame, 12);
    assert.equal(cmd?.needsConfirm, true);
  });

  it("never auto-executes — UI must show a confirmation card", () => {
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const runtime = fs.readFileSync(path.join(process.cwd(), "src/lib/conversation/runtime.ts"), "utf8");
    const prompt = fs.readFileSync(path.join(process.cwd(), "src/lib/domain/conversation.ts"), "utf8");
    assert.match(studio, /AnimationCommandCard/);
    assert.match(studio, /setPendingCommand/);
    assert.match(studio, /confirmPendingCommand/);
    assert.match(studio, /confirmed: true/);
    assert.match(runtime, /parseAnimationCommand/);
    assert.match(runtime, /請在確認卡按「確認執行」/);
    assert.match(prompt, /Always show a confirmation card/);
    assert.doesNotMatch(studio, /parseAnimationCommand\([\s\S]{0,80}tool\.mutate/);
  });
});
