/**
 * The real server turns rex's v1 deprecation notice off for its children.
 *
 * `tests/unit/server/start-legacy-notice.test.ts` proves the helper sets the
 * variable, but it would pass unchanged if `startServer` stopped calling it.
 * Every dashboard spawn passes `process.env` through, so this boots the real
 * server and reads the env its children inherit.
 *
 * A child process for the reason `feature-gate-enforcement.test.ts` gives:
 * `startServer` has no close handle, and its exit is the teardown.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeTempDir } from "../helpers/temp-dir.js";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";

const execFileAsync = promisify(execFile);

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;

describe("startServer silences rex's legacy notice for its children", () => {
  beforeAll(() => {
    assertFreshServerBuild();
  });

  it("leaves NDX_LEGACY_NOTICE=off on the env every rex spawn inherits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ndx-legacy-notice-"));
    try {
      const scriptPath = join(dir, "driver.mjs");
      await writeFile(
        scriptPath,
        `
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};
await startServer(${JSON.stringify(dir)}, 0, {});
console.log("NDX_NOTICE=" + JSON.stringify(process.env.NDX_LEGACY_NOTICE ?? null));
// Let the watchers settle before the hard exit (see feature-gate-enforcement.test.ts).
await new Promise((r) => setTimeout(r, 500));
process.exit(0);
`,
        "utf-8",
      );

      // The exit code is not asserted, for the Windows teardown reason given in
      // feature-gate-enforcement.test.ts; the printed line is the answer.
      const { NDX_LEGACY_NOTICE: _drop, ...env } = process.env;
      let stdout = "";
      try {
        stdout = (await execFileAsync(process.execPath, [scriptPath], {
          env,
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        })).stdout;
      } catch (err) {
        stdout = (err as { stdout?: string }).stdout ?? "";
      }

      const match = /NDX_NOTICE=(.*)/.exec(stdout);
      if (!match) throw new Error(`driver printed no answer. stdout:\n${stdout}`);
      expect(JSON.parse(match[1])).toBe("off");
    } finally {
      await removeTempDir(dir);
    }
  }, 90_000);
});
