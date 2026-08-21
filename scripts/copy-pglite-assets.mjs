#!/usr/bin/env node
/**
 * PGLite loads sibling emscripten payloads (`pglite.data`, `pglite.wasm`,
 * `initdb.wasm`) via relative paths. Nitro/rolldown can emit the JS chunk
 * without those files, so local `vite preview` (no DATABASE_URL) 500s.
 * Deployed Neon never hits this path.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const dests = [
  join(root, ".vercel", "output", "functions", "__server.func"),
  join(root, ".vercel", "output", "functions", "__server.func", "_libs"),
];
const files = ["pglite.data", "pglite.wasm", "initdb.wasm"];

for (const dir of dests) {
  await mkdir(dir, { recursive: true });
  for (const name of files) {
    await copyFile(join(dist, name), join(dir, name));
  }
}
console.log("[app-builder] copied PGLite wasm/data next to the server function");
