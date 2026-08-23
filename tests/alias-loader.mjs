/** Resolve `@/` to `src/` so node --test can import executeTool. */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  const rest = specifier.slice(2);
  const candidates = [
    path.join(SRC, rest),
    path.join(SRC, rest) + ".ts",
    path.join(SRC, rest) + ".tsx",
    path.join(SRC, rest, "index.ts"),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) return nextResolve(specifier, context);
  return { url: pathToFileURL(hit).href, shortCircuit: true };
}
