/**
 * Vitest setupFile: point the ndx home at an empty temp directory.
 *
 * sourcevision's pack loader looks in `<ndx home>/packs/<version>` before
 * module resolution, so a pack installed there by the developer would shadow
 * the workspace package a test means to exercise. Tests that pass no
 * `loader.packDir` get this empty directory instead. A test that needs a pack
 * directory of its own still passes `packDir` explicitly.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "sv-test-ndx-home-"));
process.env["NDX_HOME"] = home;
delete process.env["N_DX_HOME"];
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
