import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROOTS = [
  path.join(process.cwd(), "src/components"),
  path.join(process.cwd(), "src/routes"),
];

const EXTRA = [
  "src/lib/domain/region-repair.ts",
  "src/lib/domain/sample-ball.ts",
  "src/lib/domain/animation-command.ts",
  "src/lib/domain/inbetween-strategy.ts",
  "src/lib/domain/job-progress.ts",
  "src/lib/visual/timeline-virtual.ts",
  "src/lib/visual/motion-curve-visual.ts",
  "src/lib/auth/client.ts",
  "src/lib/extract-frames.ts",
  "src/lib/commands/region-repair-tools.ts",
  "src/lib/error-component.tsx",
];

const BARE_ENGLISH =
  /\b(Generate|Timeline|Repair|Loading|Analyze|Analyzing|Animate|Review|Export|Import|Untitled|Breakdown|Workspace|Inbetween|Overlay|Provider|Ready|Failed|Success|Settings|Cancel|Confirm|Delete|Undo|Redo|Original|Problems|Error|Warning|Save|Close|Open|Play|Pause|Help|Next|Previous|Back|Home|Search|Filter|bbox|Sign-in|Sign in|Pop-up)\b/;

const ALLOW =
  /\b(FrameLab|SAM|RIFE|RTMPose|LocoTrack|SEA-RAFT|Grok|Google|GitHub|FPS|AI|JPG|PNG|WebM|JSON|Esc|Shift|Ctrl|Alt|Enter|WebM|Wan)\b/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectUiStrings(src: string): string[] {
  const out: string[] = [];
  const jsxText = />([^\n<>{}]{1,80})</g;
  let m: RegExpExecArray | null;
  while ((m = jsxText.exec(src))) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  const attrs = /\b(?:aria-label|placeholder|title|alt)=\{?["'`]([^"'`\n]+)["'`]\}?/g;
  while ((m = attrs.exec(src))) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  const quoted = /\b(?:toast\.(?:success|error|message)|confirm)\(\s*["'`]([^"'`\n]+)["'`]/g;
  while ((m = quoted.exec(src))) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

function collectQuoted(src: string): string[] {
  const out: string[] = [];
  const quoted = /["'`]([^"'`\n]{3,160})["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(src))) {
    const t = m[1].trim();
    if (t && !t.startsWith("/") && !t.includes("://") && !t.startsWith(".")) out.push(t);
  }
  return out;
}

describe("untranslated UI strings", () => {
  it("human-facing TSX has no bare English Generate/Timeline/Repair/Loading", () => {
    const files = ROOTS.flatMap((d) => walk(d));
    assert.ok(files.length > 8, "expected UI files");
    const hits: string[] = [];
    for (const file of files) {
      const strings = collectUiStrings(stripComments(fs.readFileSync(file, "utf8")));
      for (const s of strings) {
        const cleaned = s.replace(ALLOW, " ");
        if (BARE_ENGLISH.test(cleaned)) {
          hits.push(`${path.relative(process.cwd(), file)}: ${s}`);
        }
      }
    }
    assert.deepEqual(hits, []);
  });

  it("user-facing copy in domain/auth helpers has no Provider/Untitled/bbox/Loading", () => {
    const hits: string[] = [];
    for (const rel of EXTRA) {
      const file = path.join(process.cwd(), rel);
      const strings = collectQuoted(stripComments(fs.readFileSync(file, "utf8")));
      for (const s of strings) {
        const cleaned = s.replace(ALLOW, " ");
        if (BARE_ENGLISH.test(cleaned)) hits.push(`${rel}: ${s}`);
      }
    }
    assert.deepEqual(hits, []);
  });

  it("document language is zh-TW and defaults are Traditional Chinese", () => {
    const root = fs.readFileSync(path.join(process.cwd(), "src/routes/__root.tsx"), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    const studio = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/studio-app.tsx"), "utf8");
    const home = fs.readFileSync(path.join(process.cwd(), "src/components/workstation/project-home.tsx"), "utf8");
    const login = fs.readFileSync(path.join(process.cwd(), "src/routes/login.tsx"), "utf8");
    const marks = fs.readFileSync(path.join(process.cwd(), "src/lib/visual/timeline-virtual.ts"), "utf8");
    assert.match(root, /lang="zh-TW"/);
    assert.doesNotMatch(root, /lang="zh-Hant"/);
    assert.match(exec, /未命名動畫/);
    assert.match(exec, /name: "時間軸"/);
    assert.doesNotMatch(exec, /Untitled/);
    assert.match(studio, /載入中…/);
    assert.match(home, /載入中…/);
    assert.match(studio, /MODE_LABEL/);
    assert.match(studio, /動畫/);
    assert.match(studio, /修復/);
    assert.match(studio, /生成/);
    assert.match(login, /進入工作室/);
    assert.match(marks, /glyph: "生"/);
    assert.match(marks, /glyph: "修"/);
    assert.match(marks, /glyph: "停"/);
  });

  it("Code/API/DB/MCP schema stays English", () => {
    const catalog = fs.readFileSync(path.join(process.cwd(), "src/lib/mcp/catalog.ts"), "utf8");
    const errors = fs.readFileSync(path.join(process.cwd(), "src/lib/domain/errors.ts"), "utf8");
    const modes = fs.readFileSync(path.join(process.cwd(), "src/lib/visual/workspace-mode.ts"), "utf8");
    assert.match(catalog, /name: "Timeline"/);
    assert.match(catalog, /PROVIDER_NOT_AVAILABLE/);
    assert.match(catalog, /MODEL_NOT_AVAILABLE/);
    assert.match(errors, /MODEL_NOT_AVAILABLE/);
    assert.match(errors, /FRAME_NOT_FOUND/);
    assert.match(modes, /"ANIMATE"/);
    assert.match(modes, /"ANALYZE"/);
    assert.match(modes, /"REPAIR"/);
    assert.match(modes, /"REVIEW"/);
    assert.match(modes, /"GENERATE"/);
  });
});
