import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { encodeJpegBuffer, scaleRgba } from "../src/lib/domain/image-codec.ts";
import {
  PREVIEW_MAX,
  THUMB_MAX_H,
  THUMB_MAX_W,
  frameAssetRel,
  frameAssetUrl,
  isInlineJpeg,
  readProjectRel,
  writeFrameAssets,
} from "../src/lib/storage/frame-assets.ts";
import { jpegUrl } from "../src/lib/visual/jpeg-url.ts";
import { dataRoot } from "../src/lib/storage/local.ts";

const ROOT = path.join(dataRoot(), "projects", "prj-storage-test");

function solid(w, h, r, g, b) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("frame asset storage", () => {
  it("writes full / preview / thumbnail files and no inline jpeg in the path", async () => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    const jpeg = encodeJpegBuffer(solid(320, 180, 40, 80, 160), 80);
    const assets = await writeFrameAssets({
      projectId: "prj-storage-test",
      frameNumber: 7,
      jpeg,
    });
    assert.match(assets.full_asset, /^frames\/full\/F000007-/);
    assert.match(assets.preview_asset, /^frames\/preview\/F000007-/);
    assert.match(assets.thumbnail_asset, /^frames\/thumb\/F000007-/);
    assert.equal(assets.width, 320);
    assert.equal(assets.height, 180);
    const full = await readProjectRel("prj-storage-test", assets.full_asset);
    const preview = await readProjectRel("prj-storage-test", assets.preview_asset);
    const thumb = await readProjectRel("prj-storage-test", assets.thumbnail_asset);
    assert.equal(full[0], 0xff);
    assert.equal(full[1], 0xd8);
    assert.equal(preview[0], 0xff);
    assert.equal(thumb[0], 0xff);
    assert.ok(full.length > 32);
    assert.ok(thumb.length < full.length);
    assert.equal(fs.existsSync(path.join(ROOT, assets.full_asset)), true);
    assert.equal(isInlineJpeg(assets.full_asset), false);
    assert.equal(isInlineJpeg(jpeg.toString("base64")), true);
    assert.equal(isInlineJpeg(`/9j/${"A".repeat(100)}`), true);
  });

  it("preview is capped, thumbnail is smaller", () => {
    const big = solid(800, 450, 10, 20, 30);
    const preview = scaleRgba(big, PREVIEW_MAX, PREVIEW_MAX);
    const thumb = scaleRgba(big, THUMB_MAX_W, THUMB_MAX_H);
    assert.ok(preview.width <= PREVIEW_MAX);
    assert.ok(thumb.width <= THUMB_MAX_W);
    assert.ok(thumb.height <= THUMB_MAX_H);
    assert.ok(thumb.width < preview.width);
  });

  it("jpegUrl passes storage URLs through", () => {
    const url = frameAssetUrl("frm-1", "preview", "abc");
    assert.match(url, /^\/api\/frame-assets\?/);
    assert.equal(jpegUrl(url), url);
    assert.match(jpegUrl("abc123+/="), /^data:image\/jpeg;base64,/);
    assert.equal(jpegUrl(""), "");
    assert.equal(frameAssetRel("thumbnail", 3, "deadbeef"), "frames/thumb/F000003-deadbeef.jpg");
  });
});

describe("repo does not keep pixels in SQL", () => {
  it("insertFrame persists to disk and stores empty image_data", () => {
    const repo = fs.readFileSync(path.join(process.cwd(), "src/lib/framelab/repo.ts"), "utf8");
    const api = fs.readFileSync(path.join(process.cwd(), "src/lib/framelab/api.ts"), "utf8");
    const exec = fs.readFileSync(path.join(process.cwd(), "src/lib/commands/execute.ts"), "utf8");
    assert.match(repo, /writeFrameAssets/);
    assert.match(repo, /full_asset/);
    assert.match(repo, /preview_asset/);
    assert.match(repo, /thumbnail_asset/);
    assert.match(repo, /'' as image_data/);
    assert.match(repo, /spillFrameToStorage/);
    assert.match(repo, /hydrateFrame/);
    assert.doesNotMatch(api, /listFramesFull\(timeline\.id\)/);
    assert.match(api, /tier=preview/);
    assert.match(api, /tier=thumbnail/);
    assert.doesNotMatch(api, /f\.thumbnail_data/);
    assert.match(exec, /fullAsset/);
    assert.doesNotMatch(exec, /imageData: frame\.image_data/);
  });
});
