import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

/**
 * Rolldown (Vite 8 + Nitro) sometimes emits a cycle-breaker chunk
 * `_ssr/ssr.mjs` that re-exports `ssr_exports` without defining it:
 *   export { …, ssr_exports as s, … }
 * Nitro then does `import("../_ssr/ssr.mjs").then((n) => n.s)` and the
 * production server 500s with `Export 'ssr_exports' is not defined`.
 *
 * `inlineDynamicImports` / `codeSplitting: false` usually prevents the
 * split. This plugin is the safety net if the split still happens.
 */
function fixSsrExportsPlugin(): Plugin {
  return {
    name: "app-builder:fix-ssr-exports",
    apply: "build",
    closeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const { readdir, readFile, writeFile, stat } = await import("node:fs/promises");
        const { join } = await import("node:path");
        async function walk(dir: string, acc: string[] = []): Promise<string[]> {
          let entries: string[];
          try {
            entries = await readdir(dir);
          } catch {
            return acc;
          }
          for (const name of entries) {
            const p = join(dir, name);
            let st;
            try {
              st = await stat(p);
            } catch {
              continue;
            }
            if (st.isDirectory()) await walk(p, acc);
            else if (name === "ssr.mjs") acc.push(p);
          }
          return acc;
        }
        for (const root of [".vercel/output", "dist"]) {
          const files = await walk(root);
          for (const file of files) {
            let src = await readFile(file, "utf8");
            if (!src.includes("ssr_exports as s")) continue;
            if (/\b(?:var|let|const) ssr_exports\b/.test(src)) continue;
            const idx = src.lastIndexOf("export {");
            if (idx < 0) continue;
            const injection = [
              "var ssr_exports = typeof __exportAll === \"function\"",
              "  ? __exportAll({ default: () => server_default, t: () => server_exports })",
              "  : { default: server_default, t: server_exports };",
              "",
            ].join("\n");
            src = src.slice(0, idx) + injection + src.slice(idx);
            await writeFile(file, src);
            console.log("[app-builder] patched undefined ssr_exports in", file);
          }
        }
        // PGLite's emscripten payload lives next to the JS as `pglite.data`
        // / `pglite.wasm`. Nitro/rolldown may inline the JS into a chunk without
        // copying those siblings — local `vite preview` then 500s on PGLite
        // bootstrap (deployed Neon never loads this path).
        const { copyFile, mkdir } = await import("node:fs/promises");
        const dist = join("node_modules", "@electric-sql", "pglite", "dist");
        const assets = ["pglite.data", "pglite.wasm", "initdb.wasm"];
        const destDirs = [
          join(".vercel", "output", "functions", "__server.func"),
          join(".vercel", "output", "functions", "__server.func", "_libs"),
        ];
        for (const dir of destDirs) {
          try {
            await mkdir(dir, { recursive: true });
          } catch {
            continue;
          }
          for (const name of assets) {
            try {
              await copyFile(join(dist, name), join(dir, name));
            } catch {
              // ignore missing dest (Neon-only deploys)
            }
          }
        }
      },
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  // Keep the SSR environment as a single chunk so rolldown does not emit the
  // circular ssr.mjs ↔ ssr2.mjs pair that leaves `ssr_exports` undefined.
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
            // Rolldown treats this as the real "no split" switch.
            // @ts-expect-error rolldown-only output option
            codeSplitting: false,
          },
        },
      },
    },
  },
  plugins: [
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: "vercel",
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
    fixSsrExportsPlugin(),
  ],
}));
