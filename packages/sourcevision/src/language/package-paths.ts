/**
 * Package-relative paths for language-pack assets.
 *
 * Built from the module's own directory with `node:path`, never the global
 * `URL` constructor: under jsdom that global is not Node's, and
 * `fileURLToPath` rejects it. Both functions are lazy so importing the
 * library never depends on the filesystem layout.
 *
 * @module sourcevision/language/package-paths
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `<package>` root. This module sits in `src/language/` or `dist/language/`. */
function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Where `scripts/build-grammars.mjs` writes grammars: `<package>/build/grammars`. */
export function grammarBuildDir(): string {
  return join(packageRoot(), "build", "grammars");
}

/** Query files ship in `<package>/src/language/queries/<lang>`, for both src and dist. */
export function queryDir(lang: string): string {
  return join(packageRoot(), "src", "language", "queries", lang);
}
