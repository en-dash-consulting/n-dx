/**
 * Import a language pack from the n-dx workspace for a corpus or comparison
 * script: `@n-dx/lang-java` resolves to the workspace package's built `dist`.
 * Exits 2, naming the build command, when it is not built.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Loader options that make sourcevision's pack loader skip the user's pack
 * directory (`<ndx home>/packs/<version>`), so a script measures the workspace
 * packs and not a published copy installed there. The directory is empty and
 * removed at exit.
 */
export const workspaceLoader = (() => {
  const packDir = mkdtempSync(join(tmpdir(), "sv-workspace-packs-"));
  process.on("exit", () => rmSync(packDir, { recursive: true, force: true }));
  return { packDir };
})();

export async function importWorkspacePack(name) {
  try {
    return await import(name);
  } catch (error) {
    console.error(`${name} could not be imported (${error.message}) — run \`pnpm --filter ${name} build\``);
    process.exit(2);
  }
}
