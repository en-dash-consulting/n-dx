/**
 * The file paths crossReferenceChanges reads out of a PRD item's description
 * and acceptance criteria, how it matches them to changed files, and that
 * reading them stays linear on the inputs a backtracking regex would not
 * (CodeQL js/polynomial-redos, alert 19). The adversarial calls run under
 * lang-kit's `callWithinBudget`, so a regression fails here by name instead of
 * hanging the suite.
 */

import { describe, expect, it } from "vitest";

import { BOUNDED_TEST_TIMEOUT_MS, callWithinBudget } from "../../../../lang-kit/tests/helpers/call-within-budget.js";
import { crossReferenceChanges, extractFilePaths } from "../../../src/core/code-coverage.js";
import { makeTask } from "../../helpers/index.js";

const MODULE = new URL("../../../src/core/code-coverage.ts", import.meta.url);

/** The changed files among `changed` that a task described by `text` is found to cover. */
function matched(text: string, changed: string[]): string[] {
  const { affectedTasks } = crossReferenceChanges([makeTask({ description: text })], changed);
  return affectedTasks[0]?.matchedFiles ?? [];
}

describe("extractFilePaths", () => {
  // Each expected value is what the extractor gave before the regex changed,
  // except where the comment says otherwise.
  it.each([
    ["src/foo/bar.ts", ["src/foo/bar.ts"]],
    ["./lib/util.js", ["lib/util.js"]],
    ["see `src/x/y.ts` here", ["src/x/y.ts"]],
    ["(src/a.ts)", ["src/a.ts"]],
    ["/abs/path/file.md", ["abs/path/file.md"]],
    ["@scope/pkg/index.ts", ["@scope/pkg/index.ts"]],
    ["src/a.ts;src/b.ts", ["src/a.ts", "src/b.ts"]],
    ["src/a.ts, src/b.ts", ["src/a.ts", "src/b.ts"]],
    ["docs/README.md", ["docs/README.md"]],
    ["src/a_b-c/d-e.test.ts", ["src/a_b-c/d-e.test.ts"]],
    ["a/b.c.d.ts", ["a/b.c.d.ts"]],
    ["path:src/a.ts", ["src/a.ts"]],
    ['"src/a.ts"', ["src/a.ts"]],
    ["src/a.ts.", ["src/a.ts"]],
    ["node_modules/@types/node/index.d.ts", ["node_modules/@types/node/index.d.ts"]],
    // A `../` prefix is stripped to the tail the old pattern gave.
    ["../lib/x.ts", ["lib/x.ts"]],
    ["../../lib/x.ts", ["lib/x.ts"]],
    // A `.`-led directory used to lose its dot: `github/workflows/ci.yml`.
    [".github/workflows/ci.yml", [".github/workflows/ci.yml"]],
    [".claude/skills/x/SKILL.md", [".claude/skills/x/SKILL.md"]],
    ["./.github/x.yml", [".github/x.yml"]],
    ["/.github/x.yml", [".github/x.yml"]],
    ["x .changeset/foo.md (.sourcevision/manifest.json)", [".changeset/foo.md", ".sourcevision/manifest.json"]],
    ["src/.hidden/x.ts", ["src/.hidden/x.ts"]],
  ])("%j gives %j", (text, paths) => {
    expect(extractFilePaths(text)).toEqual(paths);
  });

  it("gives each path once", () => {
    expect(extractFilePaths("Edit src/a.ts and src/a.ts again")).toEqual(["src/a.ts"]);
    expect(extractFilePaths("[src/a.ts](./src/a.ts)")).toEqual(["src/a.ts"]);
  });

  // A path starts at a token boundary. The regex before let a match begin in
  // the middle of a token, so a dotted name, a URL and a version number each
  // leaked a tail that looked like a path.
  it.each([
    ["foo.bar/baz.ts", "bar/baz.ts"],
    ["https://github.com/org/repo.git", "com/org/repo.git"],
    ["v1.2/foo.ts", "2/foo.ts"],
  ])("%j no longer gives %j", (text, path) => {
    expect(extractFilePaths(text)).toEqual([]);
    expect(matched(text, [path])).toEqual([]);
  });

  it.each(["a.ts", "./a.ts", "src/", "a//b.ts", "C:\\win\\a.ts", "a/.../c.ts", ""])("%j gives nothing", (text) => {
    expect(extractFilePaths(text)).toEqual([]);
  });
});

describe("crossReferenceChanges", () => {
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
    expect(matched("src/foo/bar.ts", ["zzz/foo/bar.ts"])).toEqual([]);
  });

  it("reports a changed file as given, apart from a leading ./", () => {
    const task = makeTask({ description: "Touches src/a.ts and lib/b.ts." });
    const { affectedTasks, uncoveredChanges } = crossReferenceChanges([task], [
      "/home/u/repo/src/a.ts", "./lib/b.ts", "/abs/other.ts", "//unc/share/x.ts",
    ]);
    expect(affectedTasks[0]?.matchedFiles).toEqual(["/home/u/repo/src/a.ts", "lib/b.ts"]);
    expect(uncoveredChanges).toEqual([{ file: "/abs/other.ts" }, { file: "//unc/share/x.ts" }]);
  });
});

// Each adversarial description is one long run the path regex consumes without
// ever completing a match, so a pattern that restarts at every position does
// quadratic work. The regex before took 3.2 s on 100k of `-`, under the default
// call budget, and 56 s on 256 KiB; the current one takes under 10 ms on each
// run below.
describe("on adversarial repository input", { timeout: BOUNDED_TEST_TIMEOUT_MS }, () => {
  const SIZE = 256 * 1024;
  const changed = ["src/a.ts"];
  const nothingReferenced = { affectedTasks: [], uncoveredChanges: [{ file: "src/a.ts" }] };

  it.each(["-", "a/", "/a", "@-", "./", "../", ".a/"])("is linear on a description that is one long run of %j", async (unit) => {
    const items = [makeTask({ description: unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE) })];
    await expect(callWithinBudget<typeof crossReferenceChanges>(MODULE, "crossReferenceChanges", items, changed))
      .resolves.toEqual(nothingReferenced);
  });
});
