/**
 * The advertised 120/min/client limit must actually fire, as HTTP 429, on the
 * 121st call. Until executeTool called checkRateLimit this was documentation-only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FrameLabError } from "../src/lib/domain/errors.ts";
import {
  checkRateLimit,
  rateLimitBucketCountForTests,
  resetRateLimitForTests,
} from "../src/lib/domain/rate-limit.ts";

describe("rate limit", () => {
  it("the 121st call in a minute is RATE_LIMITED 429", () => {
    resetRateLimitForTests();
    const key = "mcp:client-121";
    for (let i = 0; i < 120; i += 1) {
      const r = checkRateLimit(key);
      assert.equal(r.remaining, 119 - i);
    }
    assert.throws(
      () => checkRateLimit(key),
      (err: unknown) =>
        err instanceof FrameLabError &&
        err.code === "RATE_LIMITED" &&
        err.status === 429,
    );
  });

  it("drops idle buckets so the process map cannot grow without bound", () => {
    resetRateLimitForTests();
    const t0 = 1_700_000_000_000;
    checkRateLimit("old-client", 10, t0);
    assert.equal(rateLimitBucketCountForTests(), 1);
    checkRateLimit("new-client", 10, t0 + 61_000);
    assert.equal(
      rateLimitBucketCountForTests(),
      1,
      "the expired client must be evicted, not left as an empty array in the Map",
    );
  });

  it("executeTool rate-limits after the scope check, not instead of it", () => {
    const exec = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "commands", "execute.ts"),
      "utf8",
    );
    const start = exec.indexOf("export async function executeTool");
    const end = exec.indexOf("async function dispatch(");
    const body = exec.slice(start, end);
    const allowed = body.indexOf("assertToolAllowed(ctx.scopes, tool)");
    const limit = body.search(/checkRateLimit\(/);
    const dispatch = body.indexOf("await dispatch(ctx, tool, args)");
    assert.ok(allowed >= 0, "scope check must stay");
    assert.ok(
      limit > allowed,
      "checkRateLimit must run after assertToolAllowed so a missing scope is 403, not a consumed slot",
    );
    assert.ok(dispatch > limit, "the tool body must not run after the cap");
  });
});
