/**
 * Cross-platform fake CLI binaries for provider spawn tests.
 *
 * Provider tests need a stand-in for `claude` / `codex` that emits fixed output
 * and exits with a chosen code. Writing that as a shebang script works only on
 * POSIX: Windows has no shebang support, so `cmd.exe` cannot execute a
 * `#!/bin/sh` or `#!/usr/bin/env node` file. `spawnCli` routes through cmd.exe
 * on win32, which then reports the fake as "exists but could not be run" — the
 * provider classifies that as a not-found error and every assertion about the
 * fake's real output fails. This helper keeps the behavior in a Node module and
 * gives each platform a shim it can actually launch.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FakeCliOptions {
  /** Base name of the binary; the test points `cli_path` at the returned path. */
  name: string;
  /** Written to stdout before exiting. */
  stdout?: string;
  /** Written to stderr before exiting. */
  stderr?: string;
  /** Process exit code. Defaults to 0. */
  exitCode?: number;
  /**
   * Read stdin to EOF before emitting output. Providers deliver the prompt on
   * stdin, so a fake that exits first can make the parent's write fail with
   * EPIPE. Defaults to false — enable it for the fakes that need to drain.
   */
  drainStdin?: boolean;
}

/**
 * Write a fake CLI into `dir` and return the path to launch.
 *
 * @returns Absolute path to the shim (`<name>.cmd` on win32, `<name>` elsewhere).
 */
export function writeFakeCli(dir: string, options: FakeCliOptions): string {
  const { name, stdout = "", stderr = "", exitCode = 0, drainStdin = false } = options;

  // Behavior lives in a .mjs file so it is ESM on every platform — an
  // extensionless `#!/usr/bin/env node` script loads as CommonJS, where the
  // top-level await used to drain stdin would be a syntax error.
  const impl = join(dir, `${name}-impl.mjs`);
  writeFileSync(
    impl,
    [
      ...(drainStdin ? ["for await (const _chunk of process.stdin) { /* drain */ }"] : []),
      ...(stdout ? [`process.stdout.write(${JSON.stringify(stdout)});`] : []),
      ...(stderr ? [`process.stderr.write(${JSON.stringify(stderr)});`] : []),
      `process.exit(${exitCode});`,
      "",
    ].join("\n"),
    "utf-8",
  );

  if (process.platform === "win32") {
    // `exit /b %ERRORLEVEL%` so node's exit code is what the caller observes.
    const shim = join(dir, `${name}.cmd`);
    writeFileSync(shim, `@echo off\r\nnode "${impl}" %*\r\nexit /b %ERRORLEVEL%\r\n`, "utf-8");
    return shim;
  }

  const shim = join(dir, name);
  writeFileSync(shim, `#!/bin/sh\nexec node "${impl}" "$@"\n`, "utf-8");
  chmodSync(shim, 0o755);
  return shim;
}
