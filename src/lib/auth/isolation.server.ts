import { getRequest } from "@tanstack/react-start/server";

/**
 * Fetch-Metadata sibling isolation — **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file imports `@tanstack/react-start/server`
 * (`getRequest` → Node `AsyncLocalStorage`). If it is imported from a dual
 * client/server module under a non-`.server` name, Vite ships it to the browser
 * and the app dies with: `AsyncLocalStorage is not a constructor`.
 *
 * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY
 * UNTRUSTED, and a `SameSite=Lax` session cookie IS sent on same-site
 * subrequests — so without this, a malicious sibling could make a SCRIPTED
 * (fetch/XHR/form-POST) request to this app's server functions and ride this
 * app's session cookie.
 *
 * We allow only: same-origin requests (this app's own client), non-browser
 * requests (SSR / server-to-server, which send no `Sec-Fetch-Site` *and* no
 * `Origin`/`Referer`), and top-level GET navigations (how the OAuth callback
 * and normal page loads arrive). Every cross-site / same-site *scripted*
 * request is rejected, including CORS-simple multipart POSTs that omit
 * Fetch-Metadata but still send `Origin`/`Referer`. Together with `__Host-`
 * cookies and Better Auth's `trustedOrigins`, this closes the sibling-tenant
 * attack surface. Enforced at `authMiddleware`, cookie REST, `/api/videos`,
 * and `/api/frame-assets`.
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteHeaders(request: Request): void {
  const h = request.headers;
  const dest = h.get("sec-fetch-dest");
  const isTopLevelGet =
    h.get("sec-fetch-mode") === "navigate" &&
    request.method.toUpperCase() === "GET" &&
    dest !== "object" &&
    dest !== "embed";
  if (isTopLevelGet) return;

  const site = h.get("sec-fetch-site");
  // The app's own client, or a user-initiated navigation (Sec-Fetch-Site: none).
  if (site === "same-origin" || site === "none") return;
  // Fetch-Metadata: same-site (*.grok.me sibling) and cross-site are both hostile.
  if (site) throw new CrossSiteRequestError();

  // CORS-simple requests (multipart POST, <img>) may omit Sec-Fetch-Site.
  // Origin / Referer still fire and a Lax cookie still rides along.
  let requestOrigin = "";
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return;
  }
  const origin = h.get("origin");
  if (origin) {
    if (origin === "null" || origin !== requestOrigin) throw new CrossSiteRequestError();
  }
  const referer = h.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== requestOrigin) throw new CrossSiteRequestError();
    } catch (err) {
      if (err instanceof CrossSiteRequestError) throw err;
    }
  }
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(): void {
  const request = getRequest();
  if (!request) return; // no request context (e.g. build) — nothing to guard
  assertSameSiteHeaders(request);
}
