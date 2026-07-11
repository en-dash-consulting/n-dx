/**
 * Cross-package parity guard for Windows CLI token quoting.
 *
 * `quoteWindowsToken` / `buildWindowsCliCommandLine` are intentionally
 * duplicated between two packages (the orchestration tier must not import
 * @n-dx/llm-client — spawn-only rule):
 *   - packages/llm-client/src/exec.ts   (canonical)
 *   - packages/core/win-spawn.js         (core-side twin — consumed by config.js
 *                                         and pair-programming.js)
 *
 * config.js re-exports from win-spawn.js, so testing win-spawn.js directly is
 * the primary guard; the config.js import is retained for backward compatibility.
 *
 * A divergence between the two produces different command lines for the same
 * spawn, which is exactly the class of Windows bug this hardening work fixes.
 * This test asserts both implementations emit IDENTICAL command lines for a
 * table of edge-case tokens (spaces, embedded quotes, trailing backslash,
 * cmd.exe metacharacters, empty string, %VAR%).
 *
 * llm-client is imported from its built dist (root tests run against compiled
 * artifacts; the vitest globalSetup verifies the build exists).
 */
import { describe, it, expect } from "vitest";
import { buildWindowsCliCommandLine as buildLlm } from "../../packages/llm-client/dist/public.js";
import { buildWindowsCliCommandLine as buildWinSpawn } from "../../packages/core/win-spawn.js";
import { buildWindowsCliCommandLine as buildConfig } from "../../packages/core/config.js";

/** Edge-case tokens exercised through both builders as args. */
const EDGE_TOKENS = [
  "claude", // plain
  "--print", // flag
  "hello world", // spaces
  'has"quote', // embedded quote
  'say "hello"', // spaces + embedded quotes
  "C:\\tools\\claude.cmd", // path, no space
  "C:\\Program Files\\claude\\claude.cmd", // spaced path
  "C:\\Users\\Tom&Jerry\\out.txt", // cmd.exe metacharacter (&)
  "a|b>c<d^e(f)g!h", // metacharacter soup
  "", // empty positional arg
  "C:\\dir with space\\", // trailing backslash before closing quote
  'a\\"b', // backslash run before embedded quote
  "%USERPROFILE%\\out", // %VAR% (expansion survives quoting — documented limitation)
];

describe("Windows quoting parity: exec.ts twin === win-spawn.js twin", () => {
  it("produces identical command lines for the edge-case token table", () => {
    const binary = "C:\\Program Files\\claude\\claude.cmd";
    for (const token of EDGE_TOKENS) {
      const args = ["--flag", token, "tail"];
      expect(buildWinSpawn(binary, args)).toBe(buildLlm(binary, args));
    }
  });

  it("produces identical command lines when the binary itself is an edge case", () => {
    for (const binary of EDGE_TOKENS) {
      const args = ["--print", "hi"];
      expect(buildWinSpawn(binary, args)).toBe(buildLlm(binary, args));
    }
  });
});

describe("config.js re-exports win-spawn.js (backward compat)", () => {
  it("config.js and win-spawn.js emit identical command lines", () => {
    const binary = "C:\\Program Files\\claude\\claude.cmd";
    for (const token of EDGE_TOKENS) {
      const args = ["--flag", token, "tail"];
      expect(buildConfig(binary, args)).toBe(buildWinSpawn(binary, args));
    }
  });
});
