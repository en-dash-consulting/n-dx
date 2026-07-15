/**
 * Windows spawn compatibility tests.
 *
 * Verifies that orchestration-layer scripts use platform-compatible spawn
 * patterns. On Windows, Node.js CLIs installed via npm are registered as
 * .cmd shims — bare execFileSync("cli-name") without shell:true fails with
 * ENOENT. Similarly, spawning "node" by name is less reliable than using
 * process.execPath.
 *
 * These are source-code assertion tests that prevent regressions without
 * requiring a real Windows environment.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

function readSource(relPath) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// cli.js spawn patterns
// ---------------------------------------------------------------------------

describe("cli.js — Windows-compatible spawn patterns", () => {
  const source = readSource("packages/core/cli.js");

  it("runInitCapture uses process.execPath, not bare 'node'", () => {
    // Extract just the runInitCapture function body
    const fnStart = source.indexOf("function runInitCapture(");
    const fnEnd = source.indexOf("\nfunction ", fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    expect(fnBody).toContain("process.execPath");
    expect(fnBody).not.toMatch(/spawnTracked\(["']node["']/);
  });

  it("handlePairProgramming uses process.execPath for rex CLI invocations", () => {
    // Both execFileSync("node", [...]) calls inside handlePairProgramming
    // must be replaced with execFileSync(process.execPath, [...]).
    const fnStart = source.indexOf("async function handlePairProgramming(");
    const fnEnd = source.indexOf("\nasync function handle", fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    const bareNodeMatches = (fnBody.match(/execFileSync\(["']node["']/g) || []).length;
    expect(
      bareNodeMatches,
      "handlePairProgramming should not call execFileSync with a bare 'node' string — use process.execPath",
    ).toBe(0);
  });

  it("handlePairProgramming contains process.execPath for synchronous rex calls", () => {
    const fnStart = source.indexOf("async function handlePairProgramming(");
    const fnEnd = source.indexOf("\nasync function handle", fnStart + 1);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    expect(fnBody).toContain("process.execPath");
  });
});

// ---------------------------------------------------------------------------
// pair-programming.js — Windows-safe CLI spawn helpers for .cmd shims
// ---------------------------------------------------------------------------

describe("pair-programming.js — Windows-compatible rex CLI calls", () => {
  const source = readSource("packages/core/pair-programming.js");

  it("routes the rex status call through execFileSyncCli (win-spawn.js), not bare execFileSync with shell:true", () => {
    // The shell: "win32" + args pattern was superseded by the Windows-safe
    // helper (cmd.exe /d /s /c + verbatim quoting) — see win-spawn.js and the
    // DEP0190 guard in tests/e2e/architecture-policy.test.js.
    const callIndex = source.indexOf('execFileSyncCli("rex"');
    expect(callIndex).toBeGreaterThan(-1);

    // No CLI spawn may reintroduce the deprecated shell:true+args form.
    expect(source).not.toContain('execFileSync("rex"');
  });

  it("imports the Windows-safe helpers from win-spawn.js", () => {
    expect(source).toContain('from "./win-spawn.js"');
  });
});
