/**
 * Shared by the root scripts that are both a command and a module a test
 * imports for its exports.
 *
 * Not for a script a test copies elsewhere and runs (scripts/prompt-census.mjs):
 * the copy could not reach this file by its relative import.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Was the calling module executed directly, rather than imported?
 *
 * Compares resolved real paths rather than URL strings. The obvious form,
 * `import.meta.url === \`file://${process.argv[1]}\``, is wrong three ways:
 * on Windows `import.meta.url` is `file:///C:/...` while the concatenation
 * yields `file://C:\\...`; on POSIX a space or non-ASCII character is
 * percent-encoded on one side only; and Node resolves symlinks for
 * `import.meta.url` but not for `argv[1]`, so any symlinked path mismatches.
 *
 * Each failure is silent — the script exits 0 having done nothing, while the
 * docs and the drift tests' failure messages tell you to run it. A
 * `process.argv[1]` that does not resolve (an eval context) counts as not
 * invoked.
 *
 * @param {string} importMetaUrl  The calling module's `import.meta.url`.
 * @returns {boolean}
 */
export function invokedDirectly(importMetaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
