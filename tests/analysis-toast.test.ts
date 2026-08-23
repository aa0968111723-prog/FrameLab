import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analysisDoneToast } from "../src/lib/domain/analysis-toast.ts";

describe("analysis toast names the provider that actually ran", () => {
  it("block-match-16 toast does not contain SEA-RAFT", () => {
    const text = analysisDoneToast(
      "analyze_motion",
      JSON.stringify({ provider: "block-match-16", samples: [] }),
    );
    assert.doesNotMatch(text, /SEA-RAFT/i);
    assert.match(text, /block-match-16/);
    assert.match(text, /非 AI／CPU 近似/);
  });

  it("pose-lite toast does not contain RTMPose", () => {
    const text = analysisDoneToast(
      "analyze_pose",
      JSON.stringify({ provider: "framelab-pose-lite" }),
    );
    assert.doesNotMatch(text, /RTMPose/i);
    assert.match(text, /framelab-pose-lite/);
    assert.match(text, /非 AI／CPU 近似/);
  });

  it("real SEA-RAFT may name SEA-RAFT", () => {
    const text = analysisDoneToast("analyze_motion", { provider: "sea-raft" });
    assert.match(text, /SEA-RAFT/);
    assert.doesNotMatch(text, /非 AI/);
  });
});
