/**
 * Unit tests for `ndx migrate-layout`.
 *
 * Two halves. The pattern rewriting is pure and is tested as such — it is the
 * half most likely to be quietly wrong, because a pattern that stops matching
 * fails silently (no error, just line-ending churn or a committed run log the
 * next time someone runs `git add -A`).
 *
 * The rest drives the real thing against a real git repository, because the
 * behaviour worth pinning *is* the git behaviour: that history follows the
 * tracked paths, that the commit is renames plus two dotfiles, and that a
 * failed verification puts everything back. Mocking git would test the mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MIGRATE_COMMIT_SUBJECT,
  planMigration,
  rewriteAttributesContent,
  rewriteIgnoreContent,
  rewritePathPattern,
  runMigrateLayout,
} from "../../packages/core/migrate-layout.js";
import { resolveLayout } from "../../packages/core/layout.js";

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const GIT_OK = gitAvailable();

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf-8", timeout: 15_000 });
}

function initRepo(dir) {
  git(["init", "-q"], dir);
  // Local identity so commits succeed where the global git config has none.
  git(["config", "user.email", "ndx-test@example.com"], dir);
  git(["config", "user.name", "ndx test"], dir);
  git(["config", "commit.gpgsign", "false"], dir);
}

/**
 * A project on the legacy layout, as `ndx init` would have left one before the
 * container existed: a tracked PRD tree, an ignored run log, an untracked tool
 * directory, and the two dotfiles naming all of it.
 */
async function legacyProject(dir) {
  await mkdir(join(dir, ".rex", "prd_tree", "an-epic"), { recursive: true });
  await writeFile(join(dir, ".rex", "prd_tree", "an-epic", "index.md"), "# An epic\n");
  await writeFile(join(dir, ".rex", "execution-log.jsonl"), '{"event":"init"}\n');
  await mkdir(join(dir, ".hench", "runs"), { recursive: true });
  await writeFile(join(dir, ".hench", "config.json"), "{}\n");
  await writeFile(join(dir, ".n-dx.json"), '{"llm":{"vendor":"claude"}}\n');
  await writeFile(join(dir, ".n-dx.local.json"), "{}\n");

  await writeFile(
    join(dir, ".gitignore"),
    [
      "# n-dx runtime artifacts",
      ".rex/execution-log*.jsonl",
      ".rex/.cache/",
      ".hench/runs/",
      ".n-dx.local.json",
      // Deliberately adjacent to .n-dx.json without being it — a prefix match
      // would rename this one too.
      ".n-dx2.json",
      // A nested project's own state, which is not this project's to move.
      "packages/thing/.rex/execution-log*.jsonl",
      "node_modules/",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(dir, ".gitattributes"),
    [
      "# n-dx tools write these files with LF.",
      ".rex/**/*.md    text eol=lf",
      ".hench/**/*.json        text eol=lf",
      ".n-dx.json              text eol=lf",
      "CLAUDE.md               text eol=lf",
      "",
      ".rex/prd_tree/** merge=rex-prd",
      "",
    ].join("\n"),
  );

  await writeFile(join(dir, "README.md"), "# fixture\n");
}

describe("planMigration", () => {
  it("pairs every path field of the two layouts and nothing else", () => {
    const root = join(tmpdir(), "ndx-plan-fixture");
    const plan = planMigration(root);
    const legacy = resolveLayout(root, { mode: "legacy" });

    const fields = plan.map((mapping) => mapping.field).sort();
    const expected = Object.keys(legacy)
      .filter((key) => !["mode", "root", "container"].includes(key))
      .sort();
    expect(fields).toEqual(expected);

    // Every pair names the same field on both sides, so a field added to the
    // resolver joins the migration without an edit to migrate-layout.js.
    for (const mapping of plan) {
      expect(mapping.from).toBe(legacy[mapping.field]);
      expect(mapping.toPattern.startsWith(".ndx/")).toBe(true);
    }
  });

  it("maps the three tool directories and the loose config files", () => {
    const plan = planMigration(join(tmpdir(), "ndx-plan-fixture"));
    const byFrom = Object.fromEntries(plan.map((m) => [m.fromPattern, m.toPattern]));
    expect(byFrom[".rex"]).toBe(".ndx/rex");
    expect(byFrom[".hench"]).toBe(".ndx/hench");
    expect(byFrom[".sourcevision"]).toBe(".ndx/sourcevision");
    expect(byFrom[".n-dx.json"]).toBe(".ndx/config.json");
    expect(byFrom[".n-dx.local.json"]).toBe(".ndx/config.local.json");
  });
});

describe("rewritePathPattern", () => {
  const mappings = planMigration(join(tmpdir(), "ndx-rewrite-fixture"));

  it("rewrites a whole-token match", () => {
    expect(rewritePathPattern(".rex", mappings)).toBe(".ndx/rex");
    expect(rewritePathPattern(".n-dx.json", mappings)).toBe(".ndx/config.json");
  });

  it("rewrites a leading path segment and keeps the rest of the glob", () => {
    expect(rewritePathPattern(".rex/**/*.md", mappings)).toBe(".ndx/rex/**/*.md");
    expect(rewritePathPattern(".hench/runs/", mappings)).toBe(".ndx/hench/runs/");
    expect(rewritePathPattern(".rex/prd_tree/**", mappings)).toBe(".ndx/rex/prd_tree/**");
  });

  it("carries a negation and an anchor through untouched", () => {
    expect(rewritePathPattern("!.rex/keep-me", mappings)).toBe("!.ndx/rex/keep-me");
    expect(rewritePathPattern("/.rex/.cache/", mappings)).toBe("/.ndx/rex/.cache/");
    expect(rewritePathPattern("!/.hench/runs/", mappings)).toBe("!/.ndx/hench/runs/");
  });

  it("never matches a substring", () => {
    // This repo's own .gitignore carries both; a prefix match would turn the
    // second into `.ndx/config.json2`.
    expect(rewritePathPattern(".n-dx2.json", mappings)).toBe(".n-dx2.json");
    expect(rewritePathPattern(".n-dx-web.pid", mappings)).toBe(".ndx/web.pid");
    expect(rewritePathPattern(".rexfoo/bar", mappings)).toBe(".rexfoo/bar");
  });

  it("leaves a path that is not this project's root state alone", () => {
    expect(rewritePathPattern("packages/thing/.rex/x.jsonl", mappings))
      .toBe("packages/thing/.rex/x.jsonl");
    expect(rewritePathPattern("node_modules/", mappings)).toBe("node_modules/");
  });
});

describe("rewriteIgnoreContent", () => {
  const mappings = planMigration(join(tmpdir(), "ndx-ignore-fixture"));

  it("rewrites only the n-dx patterns and counts them", () => {
    const before = [
      "# a comment naming .rex/ that must not change",
      "",
      ".rex/execution-log*.jsonl",
      ".n-dx.local.json",
      ".n-dx2.json",
      "node_modules/",
    ].join("\n");

    const { content, rewritten } = rewriteIgnoreContent(before, mappings);
    expect(rewritten).toBe(2);
    expect(content.split("\n")).toEqual([
      "# a comment naming .rex/ that must not change",
      "",
      ".ndx/rex/execution-log*.jsonl",
      ".ndx/config.local.json",
      ".n-dx2.json",
      "node_modules/",
    ]);
  });

  it("preserves a CRLF file's carriage returns", () => {
    const { content } = rewriteIgnoreContent(".rex/x\r\n.hench/y\r\n", mappings);
    expect(content).toBe(".ndx/rex/x\r\n.ndx/hench/y\r\n");
  });
});

describe("rewriteAttributesContent", () => {
  const mappings = planMigration(join(tmpdir(), "ndx-attrs-fixture"));

  it("rewrites the pattern and leaves the attributes and alignment alone", () => {
    const before = [
      "# header",
      ".rex/**/*.md    text eol=lf",
      ".n-dx.json              text eol=lf",
      "CLAUDE.md               text eol=lf",
      ".rex/prd_tree/** merge=rex-prd",
    ].join("\n");

    const { content, rewritten } = rewriteAttributesContent(before, mappings);
    expect(rewritten).toBe(3);
    expect(content.split("\n")).toEqual([
      "# header",
      ".ndx/rex/**/*.md    text eol=lf",
      ".ndx/config.json              text eol=lf",
      "CLAUDE.md               text eol=lf",
      ".ndx/rex/prd_tree/** merge=rex-prd",
    ]);
  });
});

describe.skipIf(!GIT_OK)("runMigrateLayout", () => {
  let dir;
  let logs;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-migrate-"));
    logs = [];
    vi.spyOn(console, "log").mockImplementation((line) => logs.push(String(line)));
    vi.spyOn(console, "error").mockImplementation((line) => logs.push(String(line)));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  /** Init a repo, lay down the legacy fixture, and commit it. */
  async function committedLegacyProject() {
    initRepo(dir);
    await legacyProject(dir);
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "baseline"], dir);
  }

  it("moves every path, rewrites both dotfiles, and commits renames plus the dotfiles", async () => {
    await committedLegacyProject();

    const code = await runMigrateLayout(dir, []);
    expect(code, logs.join("\n")).toBe(0);

    // The state moved...
    for (const entry of ["rex/prd_tree/an-epic/index.md", "hench/config.json", "config.json"]) {
      expect(existsSync(join(dir, ".ndx", entry)), `.ndx/${entry}`).toBe(true);
    }
    for (const legacy of [".rex", ".hench", ".n-dx.json", ".n-dx.local.json"]) {
      expect(existsSync(join(dir, legacy)), `${legacy} should be gone`).toBe(false);
    }
    // ...including the ignored run log, which git never knew about.
    expect(existsSync(join(dir, ".ndx", "rex", "execution-log.jsonl"))).toBe(true);

    // The patterns followed the files.
    const ignore = readFileSync(join(dir, ".gitignore"), "utf-8");
    expect(ignore).toContain(".ndx/rex/execution-log*.jsonl");
    expect(ignore).toContain(".ndx/config.local.json");
    expect(ignore).toContain(".n-dx2.json");
    expect(ignore).toContain("packages/thing/.rex/execution-log*.jsonl");
    expect(readFileSync(join(dir, ".gitattributes"), "utf-8"))
      .toContain(".ndx/rex/prd_tree/** merge=rex-prd");

    // The commit is renames plus the two dotfiles, and nothing else. This is
    // the shape that makes the migration reviewable: an A/D pair instead of an
    // R means `git log --follow` stops at the move.
    const statuses = git(["show", "--name-status", "-M", "--format=", "HEAD"], dir)
      .trim().split("\n").filter(Boolean)
      .map((line) => line.split("\t"));
    const renamed = statuses.filter(([status]) => status.startsWith("R"));
    const modified = statuses.filter(([status]) => status === "M").map(([, path]) => path);

    expect(renamed.length).toBeGreaterThan(0);
    expect(modified.sort()).toEqual([".gitattributes", ".gitignore"]);
    expect(statuses.length).toBe(renamed.length + modified.length);

    // History follows: the PRD file's log reaches the baseline commit.
    const log = git(
      ["log", "--follow", "--format=%s", "--", ".ndx/rex/prd_tree/an-epic/index.md"],
      dir,
    );
    expect(log).toContain("baseline");
    expect(git(["log", "-1", "--format=%s"], dir).trim()).toBe(MIGRATE_COMMIT_SUBJECT);
  }, 60_000);

  it("is a no-op on a project already on .ndx/", async () => {
    await committedLegacyProject();
    expect(await runMigrateLayout(dir, [])).toBe(0);
    const head = git(["rev-parse", "HEAD"], dir).trim();

    logs.length = 0;
    expect(await runMigrateLayout(dir, [])).toBe(0);
    expect(logs.join("\n")).toContain("Already on the .ndx/ layout");
    expect(git(["rev-parse", "HEAD"], dir).trim()).toBe(head);
    expect(git(["status", "--porcelain"], dir).trim()).toBe("");
  }, 60_000);

  it("restores the project when verification fails", async () => {
    await committedLegacyProject();
    const head = git(["rev-parse", "HEAD"], dir).trim();
    const ignoreBefore = readFileSync(join(dir, ".gitignore"), "utf-8");
    const attrsBefore = readFileSync(join(dir, ".gitattributes"), "utf-8");

    // `rex validate` answering differently after the move than before is the
    // signal that something inside what moved did not survive it.
    let call = 0;
    const runCapture = async () => ({ code: call++ === 0 ? 0 : 1, stdout: "" });

    const code = await runMigrateLayout(dir, [], { runCapture, tools: { rex: "rex" } });
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("verification failed");

    expect(existsSync(join(dir, ".ndx")), ".ndx/ should be gone again").toBe(false);
    for (const legacy of [".rex", ".hench", ".n-dx.json", ".n-dx.local.json"]) {
      expect(existsSync(join(dir, legacy)), `${legacy} should be back`).toBe(true);
    }
    expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe(ignoreBefore);
    expect(readFileSync(join(dir, ".gitattributes"), "utf-8")).toBe(attrsBefore);

    // Nothing committed, and the index is as clean as it was — a restore that
    // left the rename staged would be the subtle half of this failure.
    expect(git(["rev-parse", "HEAD"], dir).trim()).toBe(head);
    expect(git(["status", "--porcelain"], dir).trim()).toBe("");
  }, 60_000);

  it("changes nothing under --dry-run", async () => {
    await committedLegacyProject();
    const before = git(["status", "--porcelain"], dir);

    expect(await runMigrateLayout(dir, ["--dry-run"])).toBe(0);
    expect(logs.join("\n")).toContain("--dry-run");
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(existsSync(join(dir, ".rex"))).toBe(true);
    expect(git(["status", "--porcelain"], dir)).toBe(before);
  }, 60_000);

  it("stages but does not commit under --no-commit", async () => {
    await committedLegacyProject();
    const head = git(["rev-parse", "HEAD"], dir).trim();

    expect(await runMigrateLayout(dir, ["--no-commit"])).toBe(0);
    expect(git(["rev-parse", "HEAD"], dir).trim()).toBe(head);
    const staged = git(["diff", "--cached", "--name-status", "-M"], dir);
    expect(staged).toContain(".ndx/rex/prd_tree/an-epic/index.md");
    expect(staged).toContain(".gitignore");
  }, 60_000);

  it("refuses when the index already holds unrelated work", async () => {
    await committedLegacyProject();
    await writeFile(join(dir, "unrelated.txt"), "staged\n");
    git(["add", "unrelated.txt"], dir);

    expect(await runMigrateLayout(dir, [])).toBe(1);
    expect(logs.join("\n")).toContain("staged changes");
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(existsSync(join(dir, ".rex"))).toBe(true);
  }, 60_000);

  it("refuses to commit over uncommitted work inside the paths it would move", async () => {
    await committedLegacyProject();
    // The state of `.rex/prd_tree/` for most of a working session. Staging it
    // with `-A` would put the operator's in-progress PRD edit inside a commit
    // advertised as nothing but renames.
    await writeFile(join(dir, ".rex", "prd_tree", "an-epic", "index.md"), "# An epic, edited\n");

    expect(await runMigrateLayout(dir, [])).toBe(1);
    expect(logs.join("\n")).toContain("uncommitted change");
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
    expect(existsSync(join(dir, ".rex"))).toBe(true);
  }, 60_000);

  it("migrates a dirty tree under --no-commit, leaving the commit to the operator", async () => {
    await committedLegacyProject();
    await writeFile(join(dir, ".rex", "prd_tree", "an-epic", "index.md"), "# An epic, edited\n");
    const head = git(["rev-parse", "HEAD"], dir).trim();

    expect(await runMigrateLayout(dir, ["--no-commit"]), logs.join("\n")).toBe(0);
    expect(existsSync(join(dir, ".ndx", "rex", "prd_tree", "an-epic", "index.md"))).toBe(true);
    expect(git(["rev-parse", "HEAD"], dir).trim()).toBe(head);
  }, 60_000);

  it("moves a tracked path whose file git can no longer find in the working tree", async () => {
    // What broke `git mv`: a legacy `prd.json` that rex folded into the folder
    // tree and deleted. The index still carries it, and `git mv .rex` aborts
    // the entire directory over it.
    await committedLegacyProject();
    rmSync(join(dir, ".rex", "prd_tree", "an-epic", "index.md"));
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "drop the epic"], dir);
    await writeFile(join(dir, ".rex", "config.json"), "{}\n");
    git(["add", "-A"], dir);
    git(["commit", "-q", "-m", "add config"], dir);

    expect(await runMigrateLayout(dir, []), logs.join("\n")).toBe(0);
    expect(existsSync(join(dir, ".ndx", "rex", "config.json"))).toBe(true);
    expect(existsSync(join(dir, ".rex"))).toBe(false);
  }, 60_000);

  it("moves the state of a project that is not a git repository at all", async () => {
    await legacyProject(dir);

    expect(await runMigrateLayout(dir, [])).toBe(0);
    expect(existsSync(join(dir, ".ndx", "rex", "prd_tree", "an-epic", "index.md"))).toBe(true);
    expect(existsSync(join(dir, ".rex"))).toBe(false);
    expect(logs.join("\n")).toContain("Not a git repository");
  }, 60_000);

  it("reports a project with no n-dx state instead of creating an empty container", async () => {
    initRepo(dir);
    await writeFile(join(dir, "README.md"), "# empty\n");

    expect(await runMigrateLayout(dir, [])).toBe(1);
    expect(logs.join("\n")).toContain("no n-dx state");
    expect(existsSync(join(dir, ".ndx"))).toBe(false);
  }, 60_000);
});
