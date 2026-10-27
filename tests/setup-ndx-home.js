/**
 * Vitest setupFile — point the ndx home at an empty temp directory.
 *
 * sourcevision's pack loader looks in `<ndx home>/packs/<sourcevision version>`
 * before module resolution, and `ndx sv pack add` installs there. A pack a
 * developer installed into their real `~/.ndx/packs` would shadow the workspace
 * pack a test means to exercise. The root and web suites run sourcevision's
 * analysis (in process, or through the CLIs they spawn, which inherit this
 * environment), so they get the same isolation sourcevision's own suite has
 * (packages/sourcevision/tests/setup-ndx-home.ts).
 *
 * It sets `N_DX_HOME`, the lower-precedence of the two names resolveNdxHome
 * reads, and clears `NDX_HOME`. A test that wants a home of its own sets either
 * name and wins: the hub and token e2e tests pass `N_DX_HOME` to the CLIs they
 * spawn, which an `NDX_HOME` set here would silently override.
 *
 * Once per worker process: the shared (`isolate: false`) projects re-run
 * setupFiles before every test file in the same process, and a directory and
 * exit listener per file would pile up (Node warns past ten listeners).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEY = Symbol.for("n-dx.test-ndx-home");

if (globalThis[KEY] === undefined) {
  const home = mkdtempSync(join(tmpdir(), "ndx-test-home-"));
  globalThis[KEY] = home;
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
}
process.env.N_DX_HOME = globalThis[KEY];
delete process.env.NDX_HOME;
