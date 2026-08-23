/** --import this file so node --test resolves `@/` before any test module loads. */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
