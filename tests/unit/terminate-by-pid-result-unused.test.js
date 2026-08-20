/**
 * `terminateTreeByPid`'s boolean is not evidence that a process is still alive,
 * and no stop path may report as though it were.
 *
 * The primitive documents its own contract: a true return means "not signallable
 * any more", NOT "the process we meant is gone". `kill(pid, 0)` succeeds for a
 * zombie — exited but not yet reaped — and for a recycled PID, and SIGKILL is
 * unblockable, so a false return does not distinguish "still running" from
 * "already dead, not yet reaped" from "this PID now belongs to something else".
 *
 * The two stop paths disagreed. `cli.js` discarded the result and said why;
 * `web.js` branched on it and logged `Server (PID N) did not exit within Nms of
 * SIGKILL.` — then logged `Stopped ...` on the very next line. A user stopping a
 * server that exited cleanly could see both, and the first one was wrong.
 *
 * A source assertion rather than a behavioural one on purpose: the misreport
 * needs an unreaped zombie in the window between exit and reap, which cannot be
 * staged deterministically. What CAN be checked exactly is the invariant that
 * produced it — that no caller consults the result at all.
 *
 * @see packages/core/child-lifecycle.js — `terminateTreeByPid`, which owns the contract
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

/** Every stop path that calls the primitive. */
const CALL_SITES = ["packages/core/cli.js", "packages/core/web.js"];

function readSource(relPath) {
  return readFileSync(join(ROOT, relPath), "utf-8");
}

/**
 * Lines that invoke the primitive, excluding imports and prose.
 *
 * Comments are dropped by requiring the call to open the statement: the contract
 * is discussed in comments at both sites, and matching those would report the
 * explanation as a violation.
 */
function invocationLines(source) {
  return source
    .split(/\r?\n/)
    .map((line, i) => ({ line, number: i + 1 }))
    .filter(({ line }) => /(?<!\w)terminateTreeByPid\s*\(/.test(line))
    .filter(({ line }) => !/^\s*(?:\/\/|\*|import\b)/.test(line));
}

describe("terminateTreeByPid's result is not consulted by any stop path", () => {
  it.each(CALL_SITES)("%s calls it as a bare statement", (relPath) => {
    const invocations = invocationLines(readSource(relPath));

    // Guards against the assertion silently covering nothing if the call moves
    // or is renamed.
    expect(invocations.length).toBeGreaterThan(0);

    for (const { line, number } of invocations) {
      // `await terminateTreeByPid(...)` and nothing else on the left: an
      // assignment (`const stopped = await …`) or a condition (`if (await …)`)
      // means the boolean reached a decision it cannot support.
      expect(
        line,
        `${relPath}:${number} uses the return value of terminateTreeByPid. ` +
          "That boolean cannot tell a live process from an unreaped zombie or a " +
          "recycled PID — see the contract in packages/core/child-lifecycle.js. " +
          "If a stop path needs to report failure, probe with signal 0 BEFORE " +
          "the kill, the way cli.js distinguishes EPERM from ESRCH.",
      ).toMatch(/^\s*await\s+terminateTreeByPid\s*\(/);
    }
  });

  it("web.js does not warn that the server is still running after a kill", () => {
    // Code only. The phrase is expected in the comment that records why the
    // warning was removed — keeping it greppable is the point of writing it
    // there, so forbidding the string outright would fight its own explanation.
    const codeLines = readSource("packages/core/web.js")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line));

    expect(codeLines.filter((line) => /did not exit/.test(line))).toEqual([]);
  });
});
