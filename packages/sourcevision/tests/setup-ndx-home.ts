/**
 * Vitest setupFile: point the ndx home at an empty temp directory.
 *
 * sourcevision's pack loader looks in `<ndx home>/packs/<version>` before
 * module resolution, so a pack installed there by the developer would shadow
 * the workspace package a test means to exercise. Tests that pass no
 * `loader.packDir` get this empty directory instead. A test that needs a pack
 * directory of its own still passes `packDir` explicitly.
 *
 * Once per worker process: the shared (`isolate: false`) project re-runs
 * setupFiles before every test file in the same process, and a directory and
 * exit listener per file would pile up (Node warns past ten listeners).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = Symbol.for("n-dx.sourcevision.test-ndx-home");
const worker = globalThis as { [KEY]?: string };

if (worker[KEY] === undefined) {
  const home = mkdtempSync(join(tmpdir(), "sv-test-ndx-home-"));
  worker[KEY] = home;
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
}
process.env["NDX_HOME"] = worker[KEY];
delete process.env["N_DX_HOME"];
