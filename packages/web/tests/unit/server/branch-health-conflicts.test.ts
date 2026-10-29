/**
 * The conflict classifier, from fixture stages: one case per class, the
 * near-misses that must fall to source, and the purity of the module.
 *
 * Fixture results are written the way `git -c merge.conflictStyle=diff3
 * merge-tree` writes them: base first, then the ancestor, then this branch.
 *
 * @see packages/web/src/server/branch-health/conflicts.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyConflicts,
  frontmatter,
  globToRegExp,
  parseGeneratedFiles,
  unifiedDiff,
  type ConflictContext,
  type ConflictSides,
  type PredictedConflict,
} from "../../../src/server/branch-health/index.js";

const NO_CONFIG: ConflictContext = { generatedFiles: [], rexStateDriver: false, worktrees: [] };

function sides(path: string, over: Partial<ConflictSides> = {}): ConflictSides {
  return { path, stages: [1, 2, 3], ancestor: "", base: "", branch: "", result: "", ...over };
}

function only(c: ConflictSides, ctx: ConflictContext = NO_CONFIG): PredictedConflict {
  const [out] = classifyConflicts([c], ctx);
  return out;
}

const hunk = (base: string[], ancestor: string[], branch: string[]) =>
  ["<<<<<<< origin/main", ...base, "||||||| 1234567", ...ancestor, "=======", ...branch, ">>>>>>> HEAD"];

// ── prd-children-table ──────────────────────────────────────────────────────

const V1_INDEX = ".rex/prd_tree/epic-abc123/index.md";
const FRONT = ["---", 'id: "epic-1"', 'level: "epic"', 'title: "Epic"', 'status: "pending"', "---", ""];
const TABLE_HEAD = ["## Children", "", "| Title | Status |", "|-------|--------|", "| [A](./a.md) | pending |"];

describe("prd-children-table", () => {
  const branch = [...FRONT, ...TABLE_HEAD, "| [C](./c.md) | pending |", ""].join("\n");

  it("offers checkout --ours, the post-merge repair and validate when every hunk is a Children row", () => {
    const result = [...FRONT, ...TABLE_HEAD, ...hunk(["| [B](./b.md) | pending |"], [], ["| [C](./c.md) | pending |"]), ""].join("\n");
    const c = only(sides(V1_INDEX, { result, branch }));
    expect(c.class).toBe("prd-children-table");
    expect(c.fix).toEqual({
      steps: [
        ["git", "checkout", "--ours", "--", V1_INDEX],
        ["rex", "validate", "--post-merge", "--repair"],
        ["git", "add", "--", V1_INDEX],
        ["rex", "validate"],
      ],
    });
  });

  it("is source when the base's clean change above the table would be lost by keeping this branch's copy", () => {
    // The base set the epic completed (merged cleanly) and added a row; this branch added a row.
    const merged = FRONT.map((l) => (l.startsWith("status:") ? 'status: "completed"' : l));
    const result = [...merged, ...TABLE_HEAD, ...hunk(["| [B](./b.md) | pending |"], [], ["| [C](./c.md) | pending |"]), ""].join("\n");
    const c = only(sides(V1_INDEX, { result, branch }));
    expect(c.class).toBe("source");
    expect(c.fix).toBeNull();
    expect(c.reason).toMatch(/drop that change/);
  });

  it("is source when any hunk lies outside ## Children, even with another inside it", () => {
    const front = ["---", 'id: "epic-1"', ...hunk(['status: "completed"'], ['status: "pending"'], ['status: "in_progress"']), "---", ""];
    const result = [...front, ...TABLE_HEAD, ...hunk(["| [B](./b.md) | pending |"], [], ["| [C](./c.md) | pending |"]), ""].join("\n");
    const c = only(sides(V1_INDEX, { result }));
    expect(c.class).toBe("source");
    expect(c.fix).toBeNull();
  });

  it("is source when a hunk under ## Children holds more than table rows", () => {
    const result = [...FRONT, ...TABLE_HEAD, ...hunk(["Some prose"], [], ["| [C](./c.md) | pending |"]), ""].join("\n");
    expect(only(sides(V1_INDEX, { result })).class).toBe("source");
  });
});

// ── prd-state ───────────────────────────────────────────────────────────────

describe("prd-state", () => {
  const STATE = ".rex/changes/some-change/state.yaml";
  const result = ["items:", ...hunk(['  "a": {status: "completed"}'], ['  "a": {status: "pending"}'], ['  "a": {status: "in_progress"}']), ""].join("\n");

  it("registers the rex-state driver and redoes this file's merge while it is unregistered", () => {
    const c = only(sides(STATE, { result }));
    expect(c.class).toBe("prd-state");
    expect(c.fix).toEqual({
      steps: [
        ["git", "config", "merge.rex-state.name", "n-dx PRD state merge"],
        ["git", "config", "merge.rex-state.driver", "rex merge-state %O %A %B %P"],
        ["git", "checkout", "--merge", "--", STATE],
        ["git", "diff", "--check", "HEAD", "--", STATE],
        ["git", "add", "--", STATE],
      ],
    });
  });

  it("is source once the driver is registered", () => {
    const c = only(sides(STATE, { result }), { ...NO_CONFIG, rexStateDriver: true });
    expect(c.class).toBe("source");
    expect(c.fix).toBeNull();
  });

  it("also covers the .ndx/rex layout and product/", () => {
    expect(only(sides(".ndx/rex/product/area/state.yaml", { result })).class).toBe("prd-state");
  });
});

// ── duplicate-capture ───────────────────────────────────────────────────────

describe("duplicate-capture", () => {
  const PATH = ".rex/changes/some-change/add-a-widget.md";
  const item = (id: string) => `---\nid: "${id}"\ntype: "task"\ntitle: "Add a widget"\n---\n`;

  it("keeps the base side's id and names both", () => {
    const c = only(sides(PATH, { stages: [2, 3], ancestor: null, base: item("base-id"), branch: item("branch-id"), result: null }));
    expect(c.class).toBe("duplicate-capture");
    expect(c.reason).toContain("base-id");
    expect(c.reason).toContain("branch-id");
    expect(c.reason).toMatch(/Keep base-id/);
    expect(c.fix).toEqual({
      steps: [
        ["git", "checkout", "--theirs", "--", PATH],
        ["git", "add", "--", PATH],
        ["rex", "validate", "--post-merge"],
      ],
    });
  });

  it("is not a duplicate when the titles differ or the ids match", () => {
    const other = `---\nid: "branch-id"\ntitle: "Something else"\n---\n`;
    expect(only(sides(PATH, { stages: [2, 3], ancestor: null, base: item("base-id"), branch: other, result: null })).class).toBe("source");
    expect(only(sides(PATH, { stages: [2, 3], ancestor: null, base: item("same"), branch: item("same"), result: null })).class).toBe("source");
  });
});

// ── allowlist-union ─────────────────────────────────────────────────────────

describe("allowlist-union", () => {
  const ancestor = "one\ntwo\nthree\n";
  const branch = "one\ntwo\nfrom-branch\nthree\n";
  const result = ["one", "two", ...hunk(["from-base"], [], ["from-branch"]), "three", ""].join("\n");

  it("offers this branch's lines then the base's, as a diff against this branch's copy", () => {
    const c = only(sides("allow.txt", { ancestor, base: "one\ntwo\nfrom-base\nthree\n", branch, result }));
    expect(c.class).toBe("allowlist-union");
    expect(c.fix).toEqual({
      diff: [
        "--- a/allow.txt",
        "+++ b/allow.txt",
        "@@ -1,4 +1,5 @@",
        " one",
        " two",
        " from-branch",
        "+from-base",
        " three",
        "",
      ].join("\n"),
    });
  });

  it("is source when a hunk removes or changes an ancestor line", () => {
    const changed = ["one", ...hunk(["TWO-base"], ["two"], ["TWO-branch"]), "three", ""].join("\n");
    const c = only(sides("allow.txt", { ancestor, branch: "one\nTWO-branch\nthree\n", result: changed }));
    expect(c.class).toBe("source");
    expect(c.fix).toBeNull();
  });

  it("is source when one hunk adds and another changes", () => {
    const mixed = ["one", ...hunk(["x"], [], ["y"]), ...hunk(["TWO-base"], ["two"], ["TWO-branch"]), ""].join("\n");
    expect(only(sides("allow.txt", { ancestor, branch, result: mixed })).class).toBe("source");
  });

  it("is source when the result carries no ancestor section to judge by", () => {
    const merge = ["one", "<<<<<<< origin/main", "from-base", "=======", "from-branch", ">>>>>>> HEAD", ""].join("\n");
    expect(only(sides("allow.txt", { ancestor, branch, result: merge })).class).toBe("source");
  });
});

// ── generated ───────────────────────────────────────────────────────────────

describe("generated", () => {
  const ctx: ConflictContext = {
    ...NO_CONFIG,
    generatedFiles: [{ paths: ["docs/analysis/prompt-token-baseline.*"], command: ["node", "scripts/prompt-census.mjs", "--write"] }],
  };
  const changed = ["one", ...hunk(["b"], ["a"], ["c"]), ""].join("\n");

  it("takes the base's copy, runs the declared command and adds the file, after every other fix", () => {
    const out = classifyConflicts([
      sides("docs/analysis/prompt-token-baseline.json", { result: changed }),
      sides("src/a.ts", { result: changed }),
      sides(".rex/changes/c/state.yaml", { result: changed }),
    ], ctx);
    expect(out.map((c) => c.class)).toEqual(["source", "prd-state", "generated"]);
    expect(out[2].fix).toEqual({
      steps: [
        ["git", "checkout", "--theirs", "--", "docs/analysis/prompt-token-baseline.json"],
        ["node", "scripts/prompt-census.mjs", "--write"],
        ["git", "add", "--", "docs/analysis/prompt-token-baseline.json"],
      ],
    });
  });

  it("classes nothing generated without a declaration", () => {
    expect(only(sides("docs/analysis/prompt-token-baseline.json", { result: changed })).class).toBe("source");
  });

  it("reads web.generatedFiles, dropping malformed rules", () => {
    expect(parseGeneratedFiles(undefined)).toBeUndefined();
    expect(parseGeneratedFiles([
      { paths: ["a/**"], command: ["node", "x.mjs"] },
      { paths: [], command: ["x"] },
      { paths: ["b"], command: "node x.mjs" },
      null,
    ])).toEqual([{ paths: ["a/**"], command: ["node", "x.mjs"] }]);
  });

  it("matches this repo's declarations", () => {
    const config = JSON.parse(readFileSync(join(__dirname, "../../../../../.n-dx.json"), "utf-8"));
    const rules = parseGeneratedFiles(config.web?.generatedFiles) ?? [];
    const commandFor = (path: string) => rules.find((r) => r.paths.some((g) => globToRegExp(g).test(path)))?.command;
    expect(commandFor("docs/analysis/prompt-token-baseline.json")).toEqual(["node", "scripts/prompt-census.mjs", "--write"]);
    expect(commandFor("docs/analysis/prompt-token-baseline.md")).toEqual(["node", "scripts/prompt-census.mjs", "--write"]);
    expect(commandFor(".claude/skills/iso-map/scripts/iso-map.mjs")).toEqual(["node", "scripts/build-iso-skill.mjs"]);
  });
});

// ── source ──────────────────────────────────────────────────────────────────

describe("source", () => {
  const changed = ["one", ...hunk(["b"], ["a"], ["c"]), ""].join("\n");

  it("names the other worktrees whose branch changed the path", () => {
    const c = only(sides("src/a.ts", { result: changed }), {
      ...NO_CONFIG,
      worktrees: [
        { path: "/w/one", branch: "feat/one", changed: ["src/a.ts", "src/b.ts"] },
        { path: "/w/two", branch: "feat/two", changed: ["src/b.ts"] },
      ],
    });
    expect(c.class).toBe("source");
    expect(c.otherWorktrees).toEqual([{ path: "/w/one", branch: "feat/one" }]);
  });

  it("explains deletes and binaries", () => {
    expect(only(sides("x.bin", { result: null })).reason).toMatch(/binary/);
    expect(only(sides("gone.ts", { stages: [1, 3], base: null, result: null })).reason).toMatch(/base deleted/);
    expect(only(sides("gone.ts", { stages: [1, 2], branch: null, result: null })).reason).toMatch(/branch deleted/);
  });

  it("never carries a fix, whatever the fixture", () => {
    const fixtures: ConflictSides[] = [
      sides("src/a.ts", { result: changed }),
      sides(V1_INDEX, { result: [...FRONT.slice(0, 2), ...hunk(["x"], ["y"], ["z"])].join("\n") }),
      sides(".rex/changes/c/state.yaml", { result: changed }),
      sides("bin", { result: null }),
      sides("added.ts", { stages: [2, 3], ancestor: null, base: "a\n", branch: "b\n", result: ["<<<<<<< m", "a", "||||||| empty", "=======", "b", ">>>>>>> h"].join("\n") }),
    ];
    const out = classifyConflicts(fixtures, { ...NO_CONFIG, rexStateDriver: true });
    const sources = out.filter((c) => c.class === "source");
    expect(sources).toHaveLength(fixtures.length);
    for (const c of sources) expect(c.fix).toBeNull();
  });
});

// ── helpers and purity ──────────────────────────────────────────────────────

describe("helpers", () => {
  it("reads rex frontmatter scalars", () => {
    expect(frontmatter('---\nid: "a-1"\ntitle: "Say \\"hi\\""\n---\nbody')).toEqual({ id: "a-1", title: 'Say "hi"' });
    expect(frontmatter("no frontmatter")).toEqual({ id: null, title: null });
  });

  it("globs: ** crosses directories, * does not", () => {
    expect(globToRegExp("docs/**/*.md").test("docs/a/b/c.md")).toBe(true);
    expect(globToRegExp("docs/**/*.md").test("docs/c.md")).toBe(true);
    expect(globToRegExp("docs/*.md").test("docs/a/c.md")).toBe(false);
  });

  it("diffs: pure insertion, deletion and a missing final newline", () => {
    expect(unifiedDiff("f", "a\n", "a\n")).toBe("");
    expect(unifiedDiff("f", "", "a\n")).toBe("--- a/f\n+++ b/f\n@@ -0,0 +1,1 @@\n+a\n");
    expect(unifiedDiff("f", "a\nb\n", "a\n")).toBe("--- a/f\n+++ b/f\n@@ -1,2 +1,1 @@\n a\n-b\n");
    expect(unifiedDiff("f", "a", "a\n")).toBe("--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+a\n");
  });

  it("splits distant changes into separate hunks", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join("\n") + "\n";
    const after = before.replace("l1\n", "L1\n").replace("l18\n", "L18\n");
    const diff = unifiedDiff("f", before, after);
    expect(diff.match(/^@@/gm)).toHaveLength(2);
    expect(diff).toContain("@@ -1,5 +1,5 @@");
    expect(diff).toContain("@@ -16,5 +16,5 @@");
  });

  it("classifies from its arguments alone: no fs, process or network import", () => {
    for (const file of ["conflicts.ts", "unified-diff.ts"]) {
      const src = readFileSync(join(__dirname, "../../../src/server/branch-health", file), "utf-8");
      const imports = [...src.matchAll(/^import[^;]*?from "([^"]+)"/gm)].map((m) => m[1]);
      expect(imports.every((spec) => spec.startsWith("./")), `${file} imports ${imports.join(", ")}`).toBe(true);
    }
  });
});
