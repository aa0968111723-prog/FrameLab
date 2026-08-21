import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

describe("FrameLab homepage", () => {
  it("keeps only animator actions and Traditional Chinese", () => {
    const home = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/project-home.tsx"), "utf8");
    const landing = fs.readFileSync(path.join(process.cwd(), "src/routes/index.tsx"), "utf8");
    for (const src of [home, landing]) {
      assert.match(src, /建立動畫/);
      assert.match(src, /匯入影片/);
      assert.match(src, /匯入圖片序列/);
      assert.match(src, /最近專案/);
      assert.match(src, /開啟範例/);
      assert.doesNotMatch(src, /MCP 權杖|MCP Token|createMcpTokenFn|listMcpTokensFn/);
      assert.doesNotMatch(src, /可用供應商|getModelsFn|modelStatusZh/);
      assert.doesNotMatch(src, /RTMPose|LocoTrack|SEA-RAFT|Depth Anything|Grok 視覺/);
      assert.doesNotMatch(src, /POST \/api\/mcp/);
    }
    assert.doesNotMatch(home, /bootstrapped/);
    assert.match(home, /經典彈跳球/);
  });
});
