/**
 * Package-relative paths: this package's version and the language assets it
 * still ships (the SQL queries and the grammars it builds).
 *
 * Built from the module's own directory with `node:path`, never the global
 * `URL` constructor: under jsdom that global is not Node's, and
 * `fileURLToPath` rejects it. Every function is lazy so importing the
 * library never depends on the filesystem layout.
 *
 * @module sourcevision/language/package-paths
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `<package>` root. This module sits in `src/language/` or `dist/language/`. */
function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

let version: string | undefined;

/** The `version` in this package's `package.json`; a language pack must carry the same. */
export function sourcevisionVersion(): string {
  version ??= String((JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf-8")) as { version?: unknown }).version);
  return version;
}

/** Where `@n-dx/lang-runtime`'s `scripts/build-grammars.mjs` writes grammars by default: `<package>/build/grammars`. */
export function grammarBuildDir(): string {
  return join(packageRoot(), "build", "grammars");
}

/** Query files ship in `<package>/src/language/queries/<lang>`, for both src and dist. */
export function queryDir(lang: string): string {
  return join(packageRoot(), "src", "language", "queries", lang);
}
