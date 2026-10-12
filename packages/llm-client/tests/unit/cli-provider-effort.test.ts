/**
 * The Claude CLI provider passes a matching `llm.effort` rule as
 * `--effort <level>`.
 *
 * Asserted on the real argv, not on a resolver's return value: the provider
 * dropped `CompletionRequest.effort` on the floor for several releases while
 * the API provider sent it, and nothing failed — the whole defect was a flag
 * that never reached the spawn.
 *
 * The fake CLI echoes its own argv back as the JSON envelope's `result`, so
 * what the test reads is exactly what was passed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliClient } from "../../src/cli-provider.js";
import { resetClaudeEffortWarnings } from "../../src/claude-effort.js";

/** A fake `claude` that reports the arguments it was given. */
function writeArgvEchoingFakeCli(dir: string): string {
  const impl = join(dir, "claude-impl.mjs");
  writeFileSync(
    impl,
    [
      "for await (const _chunk of process.stdin) { /* drain */ }",
      "process.stdout.write(JSON.stringify({ result: JSON.stringify(process.argv.slice(2)) }));",
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

describe("createCliClient — --effort", () => {
  let cliDir: string;
  let cliPath: string;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cliDir = mkdtempSync(join(tmpdir(), "ndx-cli-effort-"));
    cliPath = writeArgvEchoingFakeCli(cliDir);
    resetClaudeEffortWarnings();
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderr.mockRestore();
    rmSync(cliDir, { recursive: true, force: true });
  });

  async function argvFor(request: Parameters<ReturnType<typeof createCliClient>["complete"]>[0]) {
    const client = createCliClient({ claudeConfig: { cli_path: cliPath }, maxRetries: 0 });
    const result = await client.complete(request);
    return JSON.parse(result.text) as string[];
  }

  it("passes a matching rule as --effort <level>", async () => {
    const argv = await argvFor({
      prompt: "hi",
      model: "claude-opus-5-5",
      effort: "xhigh",
      taskClass: "agent.execute",
    });

    expect(argv).toContain("--effort");
    expect(argv[argv.indexOf("--effort") + 1]).toBe("xhigh");
  });

  it("passes no --effort when no rule matched", async () => {
    // And applies no per-model default: Claude Code picks its own, unlike the
    // API path where Opus 5.5 would get "high" here.
    const argv = await argvFor({ prompt: "hi", model: "claude-opus-5-5" });

    expect(argv).not.toContain("--effort");
  });

  it("drops an unknown level with a warning", async () => {
    const argv = await argvFor({
      prompt: "hi",
      model: "claude-opus-5-5",
      effort: "lots",
      taskClass: "agent.execute",
    });

    expect(argv).not.toContain("--effort");
    expect(stderr.mock.calls.flat().join(" ")).toContain('"lots"');
  });

  it("drops a rule aimed at a model that does not accept effort", async () => {
    const argv = await argvFor({
      prompt: "hi",
      model: "claude-haiku-4-5",
      effort: "max",
      taskClass: "agent.execute",
    });

    expect(argv).not.toContain("--effort");
    expect(stderr.mock.calls.flat().join(" ")).toContain("does not accept an effort setting");
  });

  it("puts --effort before the caller's own cliFlags", async () => {
    // cliFlags are appended last so a caller can still override; the resolved
    // effort must not land after them and shadow one.
    const argv = await argvFor({
      prompt: "hi",
      model: "claude-opus-5-5",
      effort: "low",
      cliFlags: ["--settings", "{}"],
    });

    expect(argv.indexOf("--effort")).toBeLessThan(argv.indexOf("--settings"));
  });
});
