import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRD_COMMIT_PATHS,
  findUncommittedWork,
  formatLoopRefusal,
  formatUncommittedWorkRefusal,
} from "../../../../src/agent/lifecycle/uncommitted-work-gate.js";
import { RM_RETRY } from "../../../helpers/index.js";

/**
 * A directory that is not inside any git repository, so the repo-relative
 * prefix resolves to "" and the porcelain lines below compare as written.
 * The nested-project behaviour (a non-empty prefix) is covered against real
 * repositories in tests/unit/agent/pre-run-gate-own-state.test.ts.
 */
const OUTSIDE_ANY_REPO = tmpdir();

/** Build gate options with the git call replaced by a canned porcelain list. */
function withDirty(lines: string[], overrides: { stagedCommitFollows?: boolean; discountPaths?: string[] } = {}) {
  return {
    projectDir: OUTSIDE_ANY_REPO,
    stagedCommitFollows: overrides.stagedCommitFollows,
    discountPaths: overrides.discountPaths,
    deps: { listDirty: vi.fn(async () => lines) },
  };
}

describe("findUncommittedWork", () => {
  it("reports a clean tree as clean", async () => {
    await expect(findUncommittedWork(withDirty([]))).resolves.toEqual({
      clean: true,
      paths: [],
    });
  });

  it("refuses when the agent left its work in the tree", async () => {
    // The exact shape of the observed failure: a new test file plus a stray
    // scratch log, neither of them committed, on the autoCommit path.
    const result = await findUncommittedWork(
      withDirty(["?? packages/hench/tests/unit/process/git-origin.test.ts", "?? root-test-output.log"]),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual([
      "packages/hench/tests/unit/process/git-origin.test.ts",
      "root-test-output.log",
    ]);
  });

  it("does not count hench's own runtime artifacts as work", async () => {
    // Same discount as the pre-run gate: a lock file hench created at startup
    // must not fail the task it was created for.
    await expect(
      findUncommittedWork(
        withDirty(["?? .hench/locks/1234.lock", "?? .hench/runs/2026-09-11-abc.json", "?? .hench/usage-cursors/s1.json"]),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("does not count the PRD paths the completion commit still covers", async () => {
    await expect(
      findUncommittedWork(
        withDirty([" M .rex/prd_tree/some-task/index.md"], { discountPaths: [...PRD_COMMIT_PATHS] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("does not count the tree-meta sidecar every PRD write rewrites", async () => {
    // Every store save rewrites `.rex/tree-meta.json`, and where the committed
    // copy predates the schema marker the rewrite changes its bytes. Left out
    // of the discount list it refused every completion in this repo.
    await expect(
      findUncommittedWork(
        withDirty([" M .rex/tree-meta.json"], { discountPaths: [...PRD_COMMIT_PATHS] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });

    await expect(
      findUncommittedWork(
        withDirty([" M .rex/execution-log.jsonl"], { discountPaths: [...PRD_COMMIT_PATHS] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });

    await expect(
      findUncommittedWork(
        withDirty(["?? .rex/execution-log.1.jsonl"], { discountPaths: [...PRD_COMMIT_PATHS] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("does not treat the sidecar prefix as a directory", async () => {
    // `.rex/tree-meta.json` is a file entry, so a sibling that merely starts
    // with the same characters must still be reported.
    const result = await findUncommittedWork(
      withDirty([" M .rex/tree-meta.json.bak"], { discountPaths: [...PRD_COMMIT_PATHS] }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual([".rex/tree-meta.json.bak"]);
  });

  it("still refuses on operator .rex content outside the PRD tree", async () => {
    const result = await findUncommittedWork(
      withDirty([" M .rex/config.json"], { discountPaths: [...PRD_COMMIT_PATHS] }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual([".rex/config.json"]);
  });

  it("discounts fully staged paths when a commit of the index still follows", async () => {
    // The interactive path: the agent stages its work and writes a commit
    // message, and performCommitPromptIfNeeded runs `git commit -F` next.
    await expect(
      findUncommittedWork(withDirty(["M  src/a.ts", "A  src/b.ts"], { stagedCommitFollows: true })),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("refuses staged paths on the autoCommit path, where nothing commits them", async () => {
    const result = await findUncommittedWork(
      withDirty(["M  src/a.ts"], { stagedCommitFollows: false }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("refuses a staged path that was edited again after staging", async () => {
    // `MM` commits the staged half and leaves the rest behind — a partial
    // commit is still a leak.
    const result = await findUncommittedWork(
      withDirty(["MM src/a.ts"], { stagedCommitFollows: true }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("refuses untracked files even when a commit of the index follows", async () => {
    // `git commit -F` never picks up an untracked file.
    const result = await findUncommittedWork(
      withDirty(["?? notes.md"], { stagedCommitFollows: true }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["notes.md"]);
  });

  it("refuses an unmerged path", async () => {
    const result = await findUncommittedWork(
      withDirty(["UU src/a.ts"], { stagedCommitFollows: true }),
    );
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src/a.ts"]);
  });

  it("discounts explicit pending paths such as review repairs", async () => {
    await expect(
      findUncommittedWork(
        withDirty([" M src/repaired.ts"], { discountPaths: ["src/repaired.ts"] }),
      ),
    ).resolves.toEqual({ clean: true, paths: [] });
  });

  it("reads the destination path of a rename", async () => {
    const result = await findUncommittedWork(withDirty(["R  old.ts -> new.ts"]));
    expect(result.paths).toEqual(["new.ts"]);
  });
});

describe("refusal messages", () => {
  it("names every uncommitted path and says nothing was discarded", () => {
    const message = formatUncommittedWorkRefusal(["src/a.ts", "root-test-output.log"]);
    expect(message).toContain("src/a.ts");
    expect(message).toContain("root-test-output.log");
    expect(message).toContain("2 path(s)");
    expect(message).toContain("Nothing was discarded");
  });

  it("truncates a very long displayed list, while the commands still carry every path", () => {
    const paths = Array.from({ length: 25 }, (_, i) => `src/file-${i}.ts`);
    const message = formatUncommittedWorkRefusal(paths);
    expect(message).toContain("src/file-19.ts");
    expect(message).toContain("…and 5 more");
    // The listing stops at 20 paths — but a truncated *pathspec* would land
    // only part of the refused work (WM2048), so the command lines carry all.
    const listedLines = message.split("\n").filter((l) => l.startsWith("  ") && !l.trimStart().startsWith("git "));
    expect(listedLines.some((l) => l.includes("src/file-20.ts"))).toBe(false);
    expect(message).toMatch(/git commit -- .*src\/file-20\.ts/);
  });

  it("explains why the loop stopped", () => {
    const message = formatLoopRefusal(["src/a.ts"]);
    expect(message).toContain("previous task");
    expect(message).toContain("src/a.ts");
  });
});

// ── Staged set vs discounted set: one definition ─────────────────────────────
//
// The completion commit's staging list and this gate's discount list both
// derive from PRD_WRITE_PATHS in the gate module. They drifted twice while
// maintained by hand — tree-meta.json staged by nobody and discounted by
// nobody (every completion refused), then the execution log staged by nobody
// but still discounted (a tracked log left silently dirty after every
// completion until the pre-run gate refused). These tests fail on the next
// drift in either direction.

describe("PRD staged and discounted sets derive from one definition", () => {
  it("the discount covers exactly the staged paths plus the operator-owned writes", async () => {
    const { PRD_STAGE_PATHS, OPERATOR_PRD_PATHS } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );

    // Every staged path is discounted (a directory as its slash-suffixed
    // prefix), every operator-owned write is discounted, and nothing else is.
    const derived = [
      ...PRD_STAGE_PATHS.map((p) => (PRD_COMMIT_PATHS.includes(`${p}/`) ? `${p}/` : p)),
      ...OPERATOR_PRD_PATHS,
    ];
    expect([...PRD_COMMIT_PATHS].sort()).toEqual([...derived].sort());
  });

  it("prdPathsToStage stages exactly the definition's hench-staged entries", async () => {
    const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { prdPathsToStage } = await import("../../../../src/agent/lifecycle/shared.js");
    const { PRD_STAGE_PATHS, OPERATOR_PRD_PATHS } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );

    // A fixture where every path in the definition exists and none is
    // gitignored, so nothing is filtered and the staged output IS the
    // hench-staged half of the definition. A hardcoded candidate added to
    // prdPathsToStage outside the definition would surface here as an extra;
    // an entry reclassified to hench-staged would appear automatically.
    const projectDir = await mkdtemp(join(tmpdir(), "hench-stage-discount-parity-"));
    try {
      for (const p of [...PRD_STAGE_PATHS, ...OPERATOR_PRD_PATHS]) {
        const abs = join(projectDir, p);
        if (p.includes("prd_tree")) {
          await mkdir(abs, { recursive: true });
        } else {
          await mkdir(join(projectDir, ".rex"), { recursive: true });
          await writeFile(abs, "x", "utf-8");
        }
      }

      const staged = await prdPathsToStage(projectDir);
      expect([...staged].sort()).toEqual([...PRD_STAGE_PATHS].sort());
      for (const operatorPath of OPERATOR_PRD_PATHS) {
        expect(staged).not.toContain(operatorPath);
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

// ── Recovery commands: validated and path-scoped (WM2048) ────────────────────
//
// A refusal that suggests `git add -A` or an unscoped commit/stash is how an
// unrelated in-flight change gets swept into a hench commit — the exact
// hazard the gate exists to prevent. Every suggested command must carry an
// explicit pathspec limited to the listed paths, and a path that no longer
// exists on disk gets `git rm --cached` rather than an add that would error.

describe("recovery commands", () => {
  const UNSCOPED = [/git add -A\b/, /git add \.(?![\w/])/, /git commit(?! --)/m, /git stash push(?! --)/];

  function expectScoped(output: string, paths: string[], deleted: string[] = []): void {
    for (const pattern of UNSCOPED) {
      expect(output, `unscoped command matched ${pattern}`).not.toMatch(pattern);
    }
    // Every listed path appears in a pathspec (after a `--`).
    const pathspecLines = output.split("\n").filter((l) => l.includes(" -- "));
    for (const p of paths) {
      expect(
        pathspecLines.some((l) => l.includes(p)),
        `path ${p} missing from every pathspec`,
      ).toBe(true);
    }
    for (const p of deleted) {
      expect(output).toContain(`git rm --cached -- ${p}`);
    }
  }

  it("uncommitted-work refusal suggests only scoped commands", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const paths = ["src/new-module.ts", "tests/new-module.test.ts"];
    const out = formatUncommittedWorkRefusal(paths, new Set());
    expect(out).toContain("git add -- src/new-module.ts tests/new-module.test.ts");
    expect(out).toContain("git commit -- src/new-module.ts tests/new-module.test.ts");
    expect(out).toContain("git stash push -- src/new-module.ts tests/new-module.test.ts");
    expectScoped(out, paths);
  });

  it("a deleted path is offered git rm --cached, and is not in the add", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const paths = ["src/kept.ts", "src/gone.ts"];
    const out = formatUncommittedWorkRefusal(paths, new Set(["src/gone.ts"]));
    expect(out).toContain("git add -- src/kept.ts");
    expect(out).not.toMatch(/git add -- .*src\/gone\.ts/);
    expectScoped(out, paths, ["src/gone.ts"]);
  });

  // A path outside the shell-inert charset must never ride inline on a
  // command line: there is no quoting that is safe in POSIX shells,
  // PowerShell, AND cmd.exe at once (cmd treats single quotes as literal
  // characters, so `&` still splits; `%VAR%` cannot be escaped interactively).
  // With pathspec files available the commands reference the file and carry no
  // arbitrary text at all; without them the fallback is POSIX-quoted with an
  // explicit caveat naming the shells it is for.

  it("routes a path containing a space through the pathspec file", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const files = { all: ".hench/recovery/pathspec.txt" };
    const out = formatUncommittedWorkRefusal(["docs/release notes.md"], new Set(), files);
    expect(out).toContain("git add --pathspec-from-file=.hench/recovery/pathspec.txt");
    expect(out).toContain("git commit --pathspec-from-file=.hench/recovery/pathspec.txt");
    expect(out).toContain("git stash push --pathspec-from-file=.hench/recovery/pathspec.txt");
    // The name still appears in the listing above, but on no command line.
    const commandLines = out.split("\n").filter((l) => l.trimStart().startsWith("git "));
    for (const line of commandLines) {
      expect(line).not.toContain("release notes");
    }
  });

  it("keeps hostile filenames off every command line when pathspec files exist", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    // Copy/paste recovery commands: a filename an agent (or a compromised
    // repo) created must never execute — or split the command — when the
    // operator pastes into sh, PowerShell, or cmd.exe.
    const hostile = [
      "src/$(touch pwned).ts",
      "src/`touch pwned`.ts",
      "src/a;rm -rf x.ts",
      'src/a"b.ts',
      "src/$HOME.ts",
      "src/a&b.ts",
      "src/%TEMP%.ts",
      "src/it's a file.ts",
    ];
    const files = { all: ".hench/recovery/pathspec.txt" };
    const out = formatUncommittedWorkRefusal(hostile, new Set(), files);
    const commandLines = out.split("\n").filter((l) => l.trimStart().startsWith("git "));
    expect(commandLines.length).toBeGreaterThan(0);
    for (const line of commandLines) {
      // Nothing but shell-inert characters on the whole command line — no
      // quoting needed in any shell, nothing to expand or split.
      expect(line.trim(), `non-inert command line: ${line}`).toMatch(
        /^[A-Za-z0-9._/= -]+$/,
      );
    }
  });

  it("falls back to POSIX quoting with a shell caveat when no pathspec file exists", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const out = formatUncommittedWorkRefusal(["src/it's a file.ts", "src/a&b.ts"], new Set());
    // Single quotes, not double: double quotes still expand $(…) in POSIX
    // shells, and the embedded quote uses the close-escape-reopen idiom.
    expect(out).toContain(String.raw`git add -- 'src/it'\''s a file.ts' 'src/a&b.ts'`);
    // The quoting is only correct for POSIX shells, and the message says so.
    expect(out).toContain("POSIX shells");
    expect(out).toContain("cmd.exe");
  });

  it("does not print the caveat when every path is inert", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const out = formatUncommittedWorkRefusal(["src/a.ts"], new Set());
    expect(out).not.toContain("POSIX shells");
  });

  it("splits add and rm across the dedicated pathspec files", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const files = {
      all: ".hench/recovery/pathspec.txt",
      add: ".hench/recovery/pathspec-add.txt",
      rm: ".hench/recovery/pathspec-rm.txt",
    };
    const out = formatUncommittedWorkRefusal(
      ["src/kept file.ts", "src/gone file.ts"],
      new Set(["src/gone file.ts"]),
      files,
    );
    expect(out).toContain("git add --pathspec-from-file=.hench/recovery/pathspec-add.txt");
    expect(out).toContain("git rm --cached --pathspec-from-file=.hench/recovery/pathspec-rm.txt");
    expect(out).toContain("git commit --pathspec-from-file=.hench/recovery/pathspec.txt");
  });

  it("the record-commit-pending message uses the pathspec file the same way", async () => {
    const { formatRecordCommitPending } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const paths = [".rex/prd_tree/some task/index.md", ".rex/$(evil).json"];
    const files = { all: ".hench/recovery/pathspec.txt" };
    const out = formatRecordCommitPending(paths, "task-1", "boom", files);
    expect(out).toContain("git add --pathspec-from-file=.hench/recovery/pathspec.txt");
    expect(out).toContain(
      'git commit -m "chore(prd): commit PRD tree changes (task task-1 completed)" ' +
        "--pathspec-from-file=.hench/recovery/pathspec.txt",
    );
    expect(out).not.toMatch(/git add -- /);
    // And without the file it degrades to the same POSIX-quoted fallback.
    const fallback = formatRecordCommitPending(paths, "task-1", "boom");
    expect(fallback).toContain("git add -- '.rex/prd_tree/some task/index.md' '.rex/$(evil).json'");
    expect(fallback).toContain("POSIX shells");
  });

  it("the commands carry every path even when the displayed list truncates", async () => {
    const { formatUncommittedWorkRefusal } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const paths = Array.from({ length: 25 }, (_, i) => `src/f${i}.ts`);
    const out = formatUncommittedWorkRefusal(paths, new Set());
    expect(out).toContain("…and 5 more");
    expectScoped(out, paths);
  });

  it("the loop refusal and the reset-deferred skip suggest the same scoped commands", async () => {
    const { formatLoopRefusal, formatResetDeferredCommitSkipped } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const paths = [".rex/prd_tree/task/index.md"];
    for (const out of [
      formatLoopRefusal(paths, new Set()),
      formatResetDeferredCommitSkipped(paths, new Set()),
    ]) {
      expect(out).toContain("git add -- .rex/prd_tree/task/index.md");
      expectScoped(out, paths);
    }
  });

  it("prepareRecoveryPathspecs is not needed for inert paths", async () => {
    const { prepareRecoveryPathspecs } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    // Bare inline pathspecs are safe in every shell, so no file is written.
    await expect(
      prepareRecoveryPathspecs(OUTSIDE_ANY_REPO, ["src/a.ts", ".rex/prd_tree/x/index.md"]),
    ).resolves.toBeUndefined();
  });

  it("prepareRecoveryPathspecs writes the hostile names verbatim to the pathspec file", async () => {
    const { prepareRecoveryPathspecs } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "recovery-pathspec-"));
    try {
      const hostile = ["src/a&b.ts", "src/$(touch pwned).ts", "src/it's a file.ts"];
      const files = await prepareRecoveryPathspecs(dir, hostile);
      expect(files).toBeDefined();
      expect(files!.all).toBe(".hench/recovery/pathspec.txt");
      expect(files!.add).toBeUndefined();
      expect(files!.rm).toBeUndefined();
      const content = readFileSync(join(dir, ".hench/recovery/pathspec.txt"), "utf-8");
      // Verbatim, one per line: git reads these directly, no shell involved.
      expect(content).toBe("src/a&b.ts\nsrc/$(touch pwned).ts\nsrc/it's a file.ts\n");
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("prepareRecoveryPathspecs splits deleted paths into their own file", async () => {
    const { prepareRecoveryPathspecs } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "recovery-pathspec-rm-"));
    try {
      const files = await prepareRecoveryPathspecs(
        dir,
        ["src/kept file.ts", "src/gone file.ts"],
        new Set(["src/gone file.ts"]),
      );
      expect(files).toEqual({
        all: ".hench/recovery/pathspec.txt",
        add: ".hench/recovery/pathspec-add.txt",
        rm: ".hench/recovery/pathspec-rm.txt",
      });
      expect(readFileSync(join(dir, ".hench/recovery/pathspec-add.txt"), "utf-8")).toBe(
        "src/kept file.ts\n",
      );
      expect(readFileSync(join(dir, ".hench/recovery/pathspec-rm.txt"), "utf-8")).toBe(
        "src/gone file.ts\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("prepareRecoveryPathspecs C-quotes a name a plain line would misparse", async () => {
    const { prepareRecoveryPathspecs } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "recovery-pathspec-quote-"));
    try {
      // --pathspec-from-file C-unquotes an element wrapped in double quotes
      // (core.quotePath), and a raw newline would split into two entries.
      const files = await prepareRecoveryPathspecs(dir, ['"quoted".ts', "line\nbreak.ts"]);
      const content = readFileSync(join(dir, ".hench/recovery/pathspec.txt"), "utf-8");
      expect(content).toBe('"\\"quoted\\".ts"\n"line\\nbreak.ts"\n');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("deletedAmong reports exactly the listed paths that are gone from disk", async () => {
    const { deletedAmong } = await import(
      "../../../../src/agent/lifecycle/uncommitted-work-gate.js"
    );
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "deleted-among-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "kept.ts"), "x");
      const deleted = deletedAmong(dir, ["src/kept.ts", "src/gone.ts"]);
      expect([...deleted]).toEqual(["src/gone.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

// ── Against a real repository that does not gitignore .hench/mcp/ ────────────
//
// The stubbed tests above cannot catch this class of bug, and neither could
// dogfooding: this repo's own `.gitignore` lists every `.hench/` runtime path,
// so a path missing from HENCH_RUNTIME_GITIGNORE_ENTRIES is still invisible to
// `git status` here. The gate must not depend on the project having the ignore
// line — that is the whole reason the discount list exists alongside it.

describe("findUncommittedWork against a repository without the ignore lines", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true, ...RM_RETRY });
    }
  });

  /**
   * A committed repo whose `.gitignore` covers nothing under `.hench/` — the
   * state of every project initialised before the artifact in question existed.
   */
  function repoWithoutHenchIgnores(): string {
    const dir = mkdtempSync(join(tmpdir(), "hench-mcp-gate-"));
    dirs.push(dir);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    writeFileSync(join(dir, "README.md"), "# t\n");
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    return dir;
  }

  /** What `writeAgentMcpConfig` leaves behind for a Claude-vendor run. */
  function writeRunMcpConfig(dir: string, runId: string): void {
    mkdirSync(join(dir, ".hench", "mcp"), { recursive: true });
    writeFileSync(join(dir, ".hench", "mcp", `${runId}.json`), '{"mcpServers":{}}\n');
  }

  it("does not report the run's own MCP config as uncommitted work", async () => {
    // The observed failure (consumer project caos, run e3fe956f): the run
    // succeeded, this file was the only thing dirty, the completion was refused
    // and the task reset to pending.
    const dir = repoWithoutHenchIgnores();
    writeRunMcpConfig(dir, "e3fe956f");

    expect(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: dir,
        encoding: "utf-8",
      }).trim(),
    ).toBe("?? .hench/mcp/e3fe956f.json");

    await expect(findUncommittedWork({ projectDir: dir })).resolves.toEqual({
      clean: true,
      paths: [],
    });
  });

  it("still reports the agent's real work alongside it", async () => {
    const dir = repoWithoutHenchIgnores();
    writeRunMcpConfig(dir, "e3fe956f");
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");

    const result = await findUncommittedWork({ projectDir: dir });
    expect(result.clean).toBe(false);
    expect(result.paths).toEqual(["src.ts"]);
  });
});
