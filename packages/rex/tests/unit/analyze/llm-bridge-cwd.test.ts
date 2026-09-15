/**
 * Unit tests proving `spawnClaude` spawns the vendor CLI in the directory
 * set via `setProjectDir()`, not the calling process's cwd. Mirrors
 * packages/llm-client/tests/unit/cli-provider-cwd.test.ts: a fake `claude`
 * binary echoes its own `process.cwd()` back so a silently-dropped `cwd`
 * option would surface as a failing assertion instead of passing by luck.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnClaude,
  setLLMConfig,
  setClaudeConfig,
  setProjectDir,
} from "../../../src/analyze/llm-bridge.js";

/** See cli-provider-cwd.test.ts for why this is a Node script, not a shebang. */
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

describe("spawnClaude — cwd pass-through via setProjectDir", () => {
  // Order matters: setProjectDir has no public "unset" — the second test
  // relies on module state never having had setProjectDir called yet.
  it("does not override the inherited cwd when setProjectDir was never called", async () => {
    const cliDir = mkdtempSync(join(tmpdir(), "ndx-rex-cwd-bin-"));
    try {
      const cliPath = writeCwdEchoingFakeCli(cliDir);
      setLLMConfig({ vendor: "claude" });
      setClaudeConfig({ cli_path: cliPath });

      const result = await spawnClaude("hi");

      expect(result.text).toBe(process.cwd());
    } finally {
      rmSync(cliDir, { recursive: true, force: true });
    }
  });

  it("spawns the vendor CLI in the directory set by setProjectDir", async () => {
    const cliDir = mkdtempSync(join(tmpdir(), "ndx-rex-cwd-bin-"));
    const targetDir = mkdtempSync(join(tmpdir(), "ndx-rex-cwd-target-"));
    try {
      const cliPath = writeCwdEchoingFakeCli(cliDir);
      setLLMConfig({ vendor: "claude" });
      setClaudeConfig({ cli_path: cliPath });
      setProjectDir(targetDir);

      const result = await spawnClaude("hi");

      // realpathSync normalizes tmpdir()'s own symlinks (e.g. macOS
      // /tmp -> /private/tmp) to match what the child's process.cwd() reports.
      expect(result.text).toBe(realpathSync(targetDir));
    } finally {
      rmSync(cliDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
