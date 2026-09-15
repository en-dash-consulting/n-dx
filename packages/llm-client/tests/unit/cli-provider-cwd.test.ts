import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliClient } from "../../src/cli-provider.js";

/**
 * Write a fake `claude` CLI that echoes its own `process.cwd()` back as the
 * `result` field of a `--output-format json` envelope, rather than a fixed
 * string. Proves the CLI provider actually spawns the vendor binary in the
 * directory passed via `cwd` — a fixed-output fake could pass even if `cwd`
 * were silently dropped on the way to `spawnCli`.
 *
 * Behavior lives in a Node script (not a shebang script) so it runs
 * unmodified on Windows via the `.cmd` shim — mirrors `tests/helpers/fake-cli.ts`.
 */
function writeCwdEchoingFakeCli(dir: string): string {
  const impl = join(dir, "claude-impl.mjs");
  writeFileSync(
    impl,
    [
      "for await (const _chunk of process.stdin) { /* drain */ }",
      "process.stdout.write(JSON.stringify({ result: process.cwd() }));",
      "process.exit(0);",
      "",
    ].join("\n"),
    "utf-8",
  );

  if (process.platform === "win32") {
    const shim = join(dir, "claude.cmd");
    writeFileSync(shim, `@echo off\r\nnode "${impl}" %*\r\nexit /b %ERRORLEVEL%\r\n`, "utf-8");
    return shim;
  }

  const shim = join(dir, "claude");
  writeFileSync(shim, `#!/bin/sh\nexec node "${impl}" "$@"\n`, "utf-8");
  chmodSync(shim, 0o755);
  return shim;
}

describe("createCliClient — cwd pass-through", () => {
  it("spawns the vendor CLI in the directory passed as `cwd`", async () => {
    const cliDir = mkdtempSync(join(tmpdir(), "ndx-cli-cwd-bin-"));
    const targetDir = mkdtempSync(join(tmpdir(), "ndx-cli-cwd-target-"));
    try {
      const cliPath = writeCwdEchoingFakeCli(cliDir);
      const client = createCliClient({
        claudeConfig: { cli_path: cliPath },
        maxRetries: 0,
        cwd: targetDir,
      });

      const result = await client.complete({ prompt: "hi", model: "claude-sonnet-4-6" });

      // realpathSync normalizes tmpdir()'s own symlinks (e.g. macOS
      // /tmp -> /private/tmp) to match what the child's process.cwd() reports.
      expect(result.text).toBe(realpathSync(targetDir));
    } finally {
      rmSync(cliDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it("does not override the child's inherited cwd when none is provided", async () => {
    const cliDir = mkdtempSync(join(tmpdir(), "ndx-cli-cwd-bin-"));
    try {
      const cliPath = writeCwdEchoingFakeCli(cliDir);
      const client = createCliClient({
        claudeConfig: { cli_path: cliPath },
        maxRetries: 0,
      });

      const result = await client.complete({ prompt: "hi", model: "claude-sonnet-4-6" });

      expect(result.text).toBe(process.cwd());
    } finally {
      rmSync(cliDir, { recursive: true, force: true });
    }
  });
});
