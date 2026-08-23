/**
 * Regression guard for the /api/v1 cross-site write primitive.
 *
 * /api/v1 authenticates with the session cookie, so any state-changing tool
 * reachable over GET can be triggered by an <img> tag or a sibling page's
 * top-level navigation — no CSRF token involved. The path router was already
 * method-correct; the hole was the `?tool=` escape hatch, which ran any tool on
 * any method.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOOL_SCOPES } from "../src/lib/domain/permissions.ts";
import { mapRestPath } from "../src/lib/framelab/rest-map.ts";
import { assertSameSiteHeaders, CrossSiteRequestError } from "../src/lib/auth/isolation.server.ts";

const restMapSrc = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "framelab", "rest-map.ts"),
  "utf8",
);
const restHttpSrc = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "framelab", "rest-http.ts"),
  "utf8",
);

describe("REST method safety", () => {
  it("routes every GET path to a READ-scope tool", () => {
    // The GET guard in rest-http is only sound while this holds: if a mutating
    // tool ever gets a GET route, the guard would start 405-ing a real endpoint
    // (and that endpoint would be a CSRF sink).
    const blocks = restMapSrc.split(/\n {2}if \(/).slice(1);
    const getBlocks = blocks.filter((b) => /m === "GET"/.test(b));
    assert.ok(getBlocks.length >= 40, `expected the documented GET surface, saw ${getBlocks.length}`);
    const offenders: string[] = [];
    for (const b of getBlocks) {
      const tool = b.match(/tool: "(\w+)"/)?.[1];
      if (tool && TOOL_SCOPES[tool] !== "READ") {
        offenders.push(`${tool} (${TOOL_SCOPES[tool] ?? "unmapped"})`);
      }
    }
    assert.deepEqual(offenders, [], `GET routes must be read-only: ${offenders.join(", ")}`);
  });

  it("never maps a mutating tool onto GET", () => {
    // Spot-check the destructive paths that do exist, via the real router.
    const mutating: [string, string][] = [
      ["/api/v1/projects", "create_project"],
      ["/api/v1/repair/range", "repair_frame_range"],
      ["/api/v1/interpolate", "interpolate_frames"],
    ];
    for (const [p] of mutating) {
      const viaGet = mapRestPath("GET", p, {});
      if (viaGet) {
        assert.equal(
          TOOL_SCOPES[viaGet.tool],
          "READ",
          `${p} resolves to ${viaGet.tool} on GET, which is not read-only`,
        );
      }
    }
  });

  it("rejects non-READ tools on GET in the handler", () => {
    assert.match(
      restHttpSrc,
      /method === "GET" \|\| method === "HEAD"/,
      "handleRest must gate the method before executing a tool",
    );
    assert.match(restHttpSrc, /TOOL_SCOPES\[tool\] !== "READ"/);
    assert.match(restHttpSrc, /status: 405/);
  });

  it("applies sibling-origin isolation to cookie-authenticated REST", () => {
    // Bearer/MCP clients are legitimately cross-origin; the cookie path is not.
    assert.match(
      restHttpSrc,
      /assertSameSiteRequest\(\)/,
      "cookie auth must clear the same Fetch-Metadata bar as authMiddleware",
    );
    const bearerIdx = restHttpSrc.indexOf("bearer fl_");
    const assertIdx = restHttpSrc.indexOf("assertSameSiteRequest()");
    assert.ok(
      assertIdx > bearerIdx,
      "the isolation check belongs on the cookie branch, not ahead of bearer auth",
    );
  });
});

function readRoute(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src", "routes", "api", name), "utf8");
}

function siblingMultipart(url: string, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: {
      origin: "https://evil.grok.me",
      referer: "https://evil.grok.me/steal",
      "content-type": "multipart/form-data; boundary=----FrameLabAttack",
    },
  });
}

describe("cookie routes outside /api/v1", () => {
  it("POST /api/videos asserts same-site after getSessionUser and answers 403", () => {
    const src = readRoute("videos.ts");
    const sessionIdx = src.indexOf("getSessionUser()");
    const assertIdx = src.indexOf("assertSameSiteRequest()");
    assert.ok(sessionIdx >= 0, "videos POST must look up the session");
    assert.ok(
      assertIdx > sessionIdx,
      "assertSameSiteRequest() must run after getSessionUser() — a Lax cookie " +
        "is already on the request; isolation has to reject the sibling before ingest",
    );
    assert.match(src, /status:\s*403/, "cross-site cookie POSTs must return 403");
  });

  it("GET /api/frame-assets asserts same-site after getSessionUser and answers 403", () => {
    const src = readRoute("frame-assets.ts");
    const sessionIdx = src.indexOf("getSessionUser()");
    const assertIdx = src.indexOf("assertSameSiteRequest()");
    assert.ok(sessionIdx >= 0, "frame-assets GET must look up the session");
    assert.ok(
      assertIdx > sessionIdx,
      "assertSameSiteRequest() must run after getSessionUser() — an <img> on a " +
        "sibling grok.me origin rides the Lax cookie and would otherwise fork JPEGs",
    );
    assert.match(src, /status:\s*403/, "cross-site cookie GETs must return 403");
  });

  it("rejects a CORS-simple sibling POST that only sends Origin/Referer (403)", () => {
    // multipart/form-data is CORS-simple: no preflight, no Sec-Fetch-Site required.
    // Older browsers and some embeds omit Fetch-Metadata; Origin/Referer still fire.
    const req = siblingMultipart("https://app.grok.me/api/videos");
    assert.equal(req.headers.get("sec-fetch-site"), null);
    assert.throws(
      () => assertSameSiteHeaders(req),
      (err: unknown) =>
        err instanceof CrossSiteRequestError && (err as CrossSiteRequestError).status === 403,
    );
  });

  it("rejects a sibling frame-asset fetch that only sends Origin/Referer (403)", () => {
    const req = siblingMultipart("https://app.grok.me/api/frame-assets?frameId=frm_x", "GET");
    assert.throws(
      () => assertSameSiteHeaders(req),
      (err: unknown) =>
        err instanceof CrossSiteRequestError && (err as CrossSiteRequestError).status === 403,
    );
  });
});
