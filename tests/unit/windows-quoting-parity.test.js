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
 * BOTH twins are imported from SOURCE. Do not repoint llm-client at
 * `dist/public.js`: comparing a source-side twin against a compiled-artifact
 * twin makes an unbuilt change to exec.ts look like a divergence between the
 * two packages. That misfire has already happened once — dist still held the
 * pre-`WINDOWS_BARE_BINARY_RE` builder, so this test reported
 * `"claude" "--print" "hi"` against source's `claude "--print" "hi"` when the
 * two implementations were in fact identical and only the build was stale.
 * Integration tests that spawn real CLIs have good reason to run against
 * compiled output; a pure-function parity guard does not.
 *
 * ## Why the twin still exists — decision, not oversight (task f3f909c2)
 *
 * Extracting these functions into a tiny foundation-tier package that both sides
 * import was evaluated and REJECTED. The evidence:
 *
 * - CHURN IS NEARLY ZERO AND CO-CHANGE IS PERFECT. win-spawn.js has been touched
 *   3 times in its life, and all 3 commits also touched exec.ts. The "update the
 *   twin" discipline has held 3/3.
 * - THERE IS NO DRIFT TODAY. A structural diff of the two implementations shows
 *   identical logic; only three explanatory comments differ.
 * - THE COST IS PERMANENT AND DISPROPORTIONATE. ~60 lines of pure string logic
 *   would buy a 7th published package (version bumps, changesets, build and
 *   exports wiring) plus an allowlist hole in the spawn-only rule. That rule's
 *   value comes from being near-absolute; one documented exception is a precedent
 *   the next contributor will cite for something less pure.
 * - A SECOND TWIN PAIR NOW EXISTS. treeKillCommand / treeKillSpawnOptions are
 *   duplicated between llm-client's process-tree.ts and core's child-lifecycle.js,
 *   guarded by tests/unit/tree-kill-parity.test.js. Extracting only the quoting
 *   pair leaves two inconsistent patterns; extracting both grows the new package
 *   from "quoting" into "Windows process primitives". Keeping twins keeps ONE
 *   documented pattern, used twice.
 *
 * WHAT WOULD JUSTIFY REVISITING: the churn assumption breaking — a change to
 * either copy that is NOT mirrored in the same commit, or a third twin pair
 * appearing. At that point the discipline is no longer carrying the weight and a
 * shared module earns its cost.
 *
 * Because the twin is staying, this guard is deliberately stronger than a sampled
 * table: see the exhaustive enumeration below.
 */
import { describe, it, expect } from "vitest";
import { buildWindowsCliCommandLine as buildLlm } from "../../packages/llm-client/src/exec.ts";
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

/**
 * The quoting algorithm's state machine only distinguishes three input classes:
 * a backslash, a double quote, and "anything else". Enumerating every string up
 * to length 5 over one representative of each — plus a space, since it is what
 * makes quoting observable — is therefore exhaustive for the logic rather than a
 * sample of it: 1365 tokens covering every reachable run-length and adjacency.
 *
 * This is what makes keeping the twin defensible. A curated table can miss the
 * one adjacency a future edit gets wrong; this cannot.
 */
function enumerateTokens(alphabet, maxLength) {
  const tokens = [""];
  let frontier = [""];
  for (let length = 1; length <= maxLength; length++) {
    const next = [];
    for (const prefix of frontier) {
      for (const ch of alphabet) next.push(prefix + ch);
    }
    tokens.push(...next);
    frontier = next;
  }
  return tokens;
}

describe("Windows quoting parity: exhaustive over the algorithm's input classes", () => {
  const ALPHABET = ["\\", '"', " ", "a"];
  const TOKENS = enumerateTokens(ALPHABET, 5);

  it("enumerates every token up to length 5 (sanity check on the generator)", () => {
    // 1 + 4 + 16 + 64 + 256 + 1024. A silently-empty generator would make the
    // assertions below pass while testing nothing.
    expect(TOKENS).toHaveLength(1365);
    expect(new Set(TOKENS).size).toBe(TOKENS.length);
  });

  it("both twins agree on every enumerated token as an argument", () => {
    const binary = "claude";
    const divergent = TOKENS.filter(
      (token) => buildWinSpawn(binary, [token]) !== buildLlm(binary, [token]),
    );
    expect(divergent).toEqual([]);
  });

  it("both twins agree on every enumerated token as the binary", () => {
    const divergent = TOKENS.filter(
      (token) => buildWinSpawn(token, ["--print"]) !== buildLlm(token, ["--print"]),
    );
    expect(divergent).toEqual([]);
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
