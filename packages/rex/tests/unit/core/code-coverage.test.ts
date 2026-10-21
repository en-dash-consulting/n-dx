/**
 * crossReferenceChanges: the file paths it reads out of a PRD item's description
 * and acceptance criteria, and that reading them stays linear on the inputs a
 * backtracking regex would not (CodeQL js/polynomial-redos, alert 19). The
 * adversarial calls run under lang-kit's `callWithinBudget`, so a regression
 * fails here by name instead of hanging the suite.
 *
 * The extractor is private, so each case feeds its text through
 * crossReferenceChanges with the candidate path as the one changed file: a
 * matched candidate was extracted, an uncovered one was not.
 */

import { describe, expect, it } from "vitest";

import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../../lang-kit/tests/helpers/call-within-budget.js";
import { crossReferenceChanges } from "../../../src/core/code-coverage.js";
import { makeTask } from "../../helpers/index.js";

const MODULE = new URL("../../../src/core/code-coverage.ts", import.meta.url);

/** The changed files among `changed` that `text` was found to reference. */
function matched(text: string, changed: string[]): string[] {
  const { affectedTasks } = crossReferenceChanges([makeTask({ description: text })], changed);
  return affectedTasks[0]?.matchedFiles ?? [];
}

describe("crossReferenceChanges", () => {
  // Each expected value is what the extractor gave before the regex changed.
  it.each([
    ["src/foo/bar.ts", "src/foo/bar.ts"],
    ["./lib/util.js", "lib/util.js"],
    ["see `src/x/y.ts` here", "src/x/y.ts"],
    ["(src/a.ts)", "src/a.ts"],
    ["/abs/path/file.md", "abs/path/file.md"],
    ["@scope/pkg/index.ts", "@scope/pkg/index.ts"],
    ["docs/README.md", "docs/README.md"],
    ["src/a_b-c/d-e.test.ts", "src/a_b-c/d-e.test.ts"],
    ["a/b.c.d.ts", "a/b.c.d.ts"],
    ["[src/a.ts](src/a.ts)", "src/a.ts"],
    ["node_modules/@types/node/index.d.ts", "node_modules/@types/node/index.d.ts"],
  ])("%j references %j", (text, path) => {
    expect(matched(text, [path])).toEqual([path]);
  });

  it("reads several paths out of one string", () => {
    expect(matched("src/a.ts;src/b.ts", ["src/a.ts", "src/b.ts"])).toEqual(["src/a.ts", "src/b.ts"]);
    expect(matched("src/a.ts, src/b.ts", ["src/b.ts", "src/a.ts"])).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("reads acceptance criteria as well as the description", () => {
    const task = makeTask({ description: "Covers src/a.ts.", acceptanceCriteria: ["`src/b.ts` exports it"] });
    const { affectedTasks, uncoveredChanges } = crossReferenceChanges([task], ["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(affectedTasks).toEqual([
      { id: "task-1", title: "Test task", level: "task", status: "pending", matchedFiles: ["src/a.ts", "src/b.ts"] },
    ]);
    expect(uncoveredChanges).toEqual([{ file: "src/c.ts" }]);
  });

  it("matches a changed file by its tail and a referenced path by its tail", () => {
    expect(matched("util.ts lives in lib/util.ts", ["packages/x/lib/util.ts"])).toEqual(["packages/x/lib/util.ts"]);
    expect(matched("packages/x/lib/util.ts", ["lib/util.ts"])).toEqual(["lib/util.ts"]);
  });

  // A path starts at a token boundary. The regex before let a match begin in
  // the middle of a token, so a dotted name, a URL and a version number each
  // leaked a tail that looked like a path. A `.`-led segment is mid-token under
  // the same rule, so a hidden directory or a `../` prefix now yields nothing
  // rather than the tail after it.
  it.each([
    ["foo.bar/baz.ts", "bar/baz.ts"],
    ["https://github.com/org/repo.git", "com/org/repo.git"],
    ["v1.2/foo.ts", "2/foo.ts"],
    ["src/.hidden/x.ts", "hidden/x.ts"],
    ["../up/x.ts", "up/x.ts"],
  ])("%j no longer references %j", (text, path) => {
    expect(matched(text, [path])).toEqual([]);
  });

  it.each(["a.ts", "./a.ts", "src/", "a//b.ts", "C:\\win\\a.ts", ""])("%j references nothing", (text) => {
    expect(matched(text, ["a.ts", "a/b.ts"])).toEqual([]);
  });
});

// Each adversarial description is made of the characters the path regex
// consumes without ever completing a match, so a pattern that restarts at every
// position does quadratic work. The regex before took 3.2 s on 100k of `-` and
// 3.8 s on 100k of `a/`, under the default call budget; 256 KiB puts it well
// over, while the current one finishes in a few milliseconds.
describe("on adversarial repository input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
  const SIZE = 256 * 1024;
  const changed = ["src/a.ts"];
  const nothingReferenced = { affectedTasks: [], uncoveredChanges: [{ file: "src/a.ts" }] };

  it("is linear on a description that is one long run of `-`", async () => {
    const items = [makeTask({ description: "-".repeat(SIZE) })];
    await expect(callWithinBudget<typeof crossReferenceChanges>(MODULE, "crossReferenceChanges", items, changed))
      .resolves.toEqual(nothingReferenced);
  });

  it("is linear on a description that is one long run of `a/`", async () => {
    const items = [makeTask({ description: "a/".repeat(SIZE / 2) })];
    await expect(callWithinBudget<typeof crossReferenceChanges>(MODULE, "crossReferenceChanges", items, changed))
      .resolves.toEqual(nothingReferenced);
  });
});
