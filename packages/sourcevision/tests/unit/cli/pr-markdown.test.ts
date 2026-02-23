import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdPrMarkdown } from "../../../src/cli/commands/pr-markdown.js";
import { CLIError } from "../../../src/cli/errors.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

describe("cmdPrMarkdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when .sourcevision directory is missing", () => {
    expect(() => cmdPrMarkdown(tmpDir)).toThrow(CLIError);
    expect(() => cmdPrMarkdown(tmpDir)).toThrow(/Sourcevision directory not found/);
  });

  it("writes .sourcevision/pr-markdown.md when git diff can be generated", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "base.txt"]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/add-pr-markdown"]);
    writeFileSync(join(tmpDir, "feature.txt"), "line1\nline2\n", "utf-8");
    git(tmpDir, ["add", "feature.txt"]);
    git(tmpDir, ["commit", "-m", "feature"]);

    writeFileSync(join(tmpDir, "base.txt"), "base\nchanged\n", "utf-8");
    writeFileSync(join(tmpDir, "scratch.tmp"), "temp\n", "utf-8");

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## PR Overview");
    expect(markdown).toContain("## Worked PRD Epics");
    expect(markdown).toContain("- No completed branch-scoped Rex items found (no_branch_scoped_completed_rex_items).");
    expect(markdown).toContain("## Important Changes");
    expect(markdown).toContain("`main...HEAD`");
    expect(markdown).toContain("- Diff footprint: 1 file(s) changed across 1 workstream(s).");
    expect(markdown).toContain("## Modified But Unstaged Files");
    expect(markdown).toContain("## Untracked Files");
    expect(markdown).toContain("`scratch.tmp`");
    expect(markdown).toContain("Workstream `(root)` had concentrated activity (1 added).");

    expect(markdown.indexOf("## PR Overview")).toBeLessThan(markdown.indexOf("## Worked PRD Epics"));
    expect(markdown.indexOf("## Worked PRD Epics")).toBeLessThan(markdown.indexOf("## Important Changes"));

    // Regression guards: avoid exhaustive file/line enumerations in default mode.
    expect(markdown).not.toContain("## Changed Files");
    expect(markdown).not.toContain("| Status | Path | + | - |");
    expect(markdown).not.toContain("## Workstream Breakdown");
    expect(markdown).not.toContain("## Notable Changes");
    expect(markdown).not.toMatch(/^- `[^`]+`: \d+ file\(s\), \+\d+ \/ -\d+/m);
  });

  it("renders explicit fallback lines when there are no important changes", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "file.txt"), "hello\n", "utf-8");
    git(tmpDir, ["add", "file.txt"]);
    git(tmpDir, ["commit", "-m", "init"]);

    git(tmpDir, ["checkout", "-b", "feature/no-diff"]);

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## PR Overview");
    expect(markdown).toContain("## Worked PRD Epics");
    expect(markdown).toContain("- No completed branch-scoped Rex items found (no_branch_scoped_completed_rex_items).");
    expect(markdown).toContain("## Important Changes");
    expect(markdown).toContain("- No important functional or feature-level changes identified.");
  });

  it("renders worked PRD tasks grouped by epic with stable ordering", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "base.txt"]);
    git(tmpDir, ["commit", "-m", "base"]);
    git(tmpDir, ["checkout", "-b", "feature/epic-list"]);

    writeFileSync(join(tmpDir, "feature.txt"), "line1\n", "utf-8");
    git(tmpDir, ["add", "feature.txt"]);
    git(tmpDir, ["commit", "-m", "feature"]);

    writeFileSync(
      join(tmpDir, ".rex", "prd.json"),
      `${JSON.stringify({
        items: [
          {
            id: "epic-2",
            title: "Epic Zebra",
            level: "epic",
            status: "in_progress",
            children: [{
              id: "feature-2",
              title: "Feature 2",
              level: "feature",
              status: "in_progress",
              children: [
                { id: "task-2a", title: "Task 2a", level: "task", status: "completed" },
                { id: "task-2b", title: "Task 2b", level: "task", status: "in_progress" },
              ],
            }],
          },
          {
            id: "epic-1",
            title: "Epic Alpha",
            level: "epic",
            status: "in_progress",
            children: [{
              id: "feature-1",
              title: "Feature 1",
              level: "feature",
              status: "in_progress",
              children: [{ id: "task-1", title: "Task 1", level: "task", status: "completed" }],
            }],
          },
        ],
      }, null, 2)}\n`,
      "utf-8",
    );

    writeFileSync(
      join(tmpDir, ".rex", "execution-log.jsonl"),
      [
        JSON.stringify({ timestamp: "2099-01-01T00:00:00.000Z", itemId: "task-2a", branch: "feature/epic-list" }),
        JSON.stringify({ timestamp: "2099-01-01T00:01:00.000Z", itemId: "task-2b", branch: "feature/epic-list" }),
        JSON.stringify({ timestamp: "2099-01-01T00:02:00.000Z", itemId: "task-1", branch: "feature/epic-list" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Worked PRD Epics");
    expect(markdown).toContain("### Epic Alpha");
    expect(markdown).toContain("### Epic Zebra");
    expect(markdown).toContain("- `Task 1` [feature: Feature 1] [completed]");
    expect(markdown).toContain("- `Task 2a` [feature: Feature 2] [completed]");
    expect(markdown).toContain("- `Task 2b` [feature: Feature 2] [executed (current status: in_progress)]");

    const alphaIndex = markdown.indexOf("### Epic Alpha");
    const zebraIndex = markdown.indexOf("### Epic Zebra");
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(zebraIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeLessThan(zebraIndex);

    const firstSection = markdown.slice(
      markdown.indexOf("## Worked PRD Epics"),
      markdown.indexOf("## Important Changes"),
    );
    expect(firstSection).toMatchInlineSnapshot(`
      "## Worked PRD Epics

      ### Epic Alpha
      - \`Task 1\` [feature: Feature 1] [completed]

      ### Epic Zebra
      - \`Task 2a\` [feature: Feature 2] [completed]
      - \`Task 2b\` [feature: Feature 2] [executed (current status: in_progress)]


      "
    `);

    cmdPrMarkdown(tmpDir);
    const rerendered = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    const secondSection = rerendered.slice(
      rerendered.indexOf("## Worked PRD Epics"),
      rerendered.indexOf("## Important Changes"),
    );
    expect(secondSection).toBe(firstSection);
  });

  it("extracts significant exported-function and feature highlights with rationale", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    mkdirSync(join(tmpDir, "app", "routes"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    writeFileSync(
      join(tmpDir, "src", "api.ts"),
      "export function fetchProfile() {\n  return \"v1\";\n}\n",
      "utf-8",
    );
    writeFileSync(
      join(tmpDir, "app", "routes", "_index.tsx"),
      "export default function Index() {\n  return <div>Home</div>;\n}\n",
      "utf-8",
    );
    writeFileSync(
      join(tmpDir, "src", "format-only.ts"),
      "export function keepSpacing() {\n  return 1;\n}\n",
      "utf-8",
    );

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "baseline"]);
    git(tmpDir, ["checkout", "-b", "feature/significant-highlights"]);

    writeFileSync(
      join(tmpDir, "src", "api.ts"),
      "export function fetchProfile() {\n  if (Math.random() > 0.5) return \"v2\";\n  return \"v1\";\n}\n",
      "utf-8",
    );
    writeFileSync(
      join(tmpDir, "app", "routes", "_index.tsx"),
      "export default function Index() {\n  return <main>Dashboard</main>;\n}\n",
      "utf-8",
    );
    writeFileSync(
      join(tmpDir, "src", "format-only.ts"),
      "export function keepSpacing() {\n      return 1 ;\n}\n",
      "utf-8",
    );
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "significant edits"]);

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Important Changes");
    expect(markdown).toContain("Modified exported function `fetchProfile` in `src/api.ts`");
    expect(markdown).toContain("Behavior changed in an exported API");
    expect(markdown).toContain("Updated route module `app/routes/_index.tsx`");
    expect(markdown).toContain("User-visible navigation or request handling likely changed in this route");
    expect(markdown).not.toContain("keepSpacing");
  });

  it("keeps default output narrative even when many workstreams change", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "base.txt"]);
    git(tmpDir, ["commit", "-m", "init"]);

    git(tmpDir, ["checkout", "-b", "feature/over-limit-sections"]);

    const changedFiles = [
      "packages/alpha/a.ts",
      "packages/beta/b.ts",
      "apps/web/a.ts",
      "apps/admin/b.ts",
      "services/api/a.ts",
      "services/auth/b.ts",
      "docs/readme.md",
      "tests/smoke.test.ts",
      "scripts/setup.sh",
    ];

    for (const relativePath of changedFiles) {
      mkdirSync(join(tmpDir, dirname(relativePath)), { recursive: true });
      writeFileSync(join(tmpDir, relativePath), "content\n", "utf-8");
    }

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "add many workstreams"]);

    cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Important Changes");
    expect(markdown).toContain("Workstream `apps/admin` had concentrated activity");
    expect(markdown).toContain("Workstream `apps/web` had concentrated activity");
    expect(markdown).toContain("Workstream `docs` had concentrated activity");
    expect(markdown).not.toContain("## Workstream Breakdown");
    expect(markdown).not.toMatch(/^- `[^`]+`: \d+ file\(s\), \+\d+ \/ -\d+/m);
  });

  it("fails when no main or origin/main base branch can be resolved", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "trunk"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "file.txt"), "hello\n", "utf-8");
    git(tmpDir, ["add", "file.txt"]);
    git(tmpDir, ["commit", "-m", "init"]);

    expect(() => cmdPrMarkdown(tmpDir)).toThrow(CLIError);
    expect(() => cmdPrMarkdown(tmpDir)).toThrow(/Could not resolve a base branch/);
  });

  it("returns NOT_A_REPO outside a git repository and skips fetch/diff operations", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    const binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const callsPath = join(tmpDir, "git-calls.log");
    const fakeGitPath = join(binDir, "git");

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
echo "$@" >> "$GIT_CALLS_LOG"
if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
  echo "fatal: not a git repository (or any of the parent directories): .git" 1>&2
  exit 128
fi
echo "unexpected git call: $@" 1>&2
exit 1
`,
      "utf-8",
    );
    chmodSync(fakeGitPath, 0o755);

    const previousPath = process.env.PATH;
    const previousCalls = process.env.GIT_CALLS_LOG;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    process.env.GIT_CALLS_LOG = callsPath;
    try {
      expect(() => cmdPrMarkdown(tmpDir)).toThrow(/NOT_A_REPO/);
      const calls = readFileSync(callsPath, "utf-8");
      expect(calls).toContain("rev-parse --is-inside-work-tree");
      expect(calls).not.toContain("ls-remote");
      expect(calls).not.toContain("diff ");
    } finally {
      process.env.PATH = previousPath;
      if (previousCalls === undefined) delete process.env.GIT_CALLS_LOG;
      else process.env.GIT_CALLS_LOG = previousCalls;
    }
  });

  it("returns DETACHED_HEAD with commit SHA and skips fetch/diff operations", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    const binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const callsPath = join(tmpDir, "git-calls.log");
    const fakeGitPath = join(binDir, "git");
    const detachedSha = "1234567890abcdef1234567890abcdef12345678";

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
echo "$@" >> "$GIT_CALLS_LOG"
if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
  echo "true"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ] && [ "$3" = "HEAD" ]; then
  echo "HEAD"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  echo "${detachedSha}"
  exit 0
fi
echo "unexpected git call: $@" 1>&2
exit 1
`,
      "utf-8",
    );
    chmodSync(fakeGitPath, 0o755);

    const previousPath = process.env.PATH;
    const previousCalls = process.env.GIT_CALLS_LOG;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    process.env.GIT_CALLS_LOG = callsPath;
    try {
      expect(() => cmdPrMarkdown(tmpDir)).toThrow(/DETACHED_HEAD/);
      expect(() => cmdPrMarkdown(tmpDir)).toThrow(new RegExp(detachedSha));
      const calls = readFileSync(callsPath, "utf-8");
      expect(calls).toContain("rev-parse --is-inside-work-tree");
      expect(calls).toContain("rev-parse --abbrev-ref HEAD");
      expect(calls).toContain("rev-parse HEAD");
      expect(calls).not.toContain("ls-remote");
      expect(calls).not.toContain("diff ");
    } finally {
      process.env.PATH = previousPath;
      if (previousCalls === undefined) delete process.env.GIT_CALLS_LOG;
      else process.env.GIT_CALLS_LOG = previousCalls;
    }
  });

  it("skips remote connectivity checks and stays non-interactive during local diff generation", () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "feature.ts"), "export function feature(): string {\n  return \"next\";\n}\n", "utf-8");
    const binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
    const callsPath = join(tmpDir, "git-calls.log");
    const fakeGitPath = join(binDir, "git");

    writeFileSync(
      fakeGitPath,
      `#!/bin/sh
echo "$@|GIT_TERMINAL_PROMPT=\${GIT_TERMINAL_PROMPT}|GCM_INTERACTIVE=\${GCM_INTERACTIVE}|GH_PROMPT_DISABLED=\${GH_PROMPT_DISABLED}" >> "$GIT_CALLS_LOG"
if [ "$1" = "rev-parse" ] && [ "$2" = "--is-inside-work-tree" ]; then
  echo "true"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--abbrev-ref" ] && [ "$3" = "HEAD" ]; then
  echo "feature/local-only"
  exit 0
fi
if [ "$1" = "rev-parse" ] && [ "$2" = "--verify" ] && [ "$3" = "main^{commit}" ]; then
  echo "0123456789abcdef0123456789abcdef01234567"
  exit 0
fi
if [ "$1" = "--no-pager" ] && [ "$2" = "diff" ] && [ "$3" = "--no-ext-diff" ] && [ "$4" = "--no-textconv" ] && [ "$5" = "--name-status" ] && [ "$6" = "main...HEAD" ]; then
  echo "M\tsrc/feature.ts"
  exit 0
fi
if [ "$1" = "--no-pager" ] && [ "$2" = "diff" ] && [ "$3" = "--no-ext-diff" ] && [ "$4" = "--no-textconv" ] && [ "$5" = "--numstat" ] && [ "$6" = "main...HEAD" ]; then
  echo "2\t0\tsrc/feature.ts"
  exit 0
fi
if [ "$1" = "--no-pager" ] && [ "$2" = "diff" ] && [ "$3" = "--no-ext-diff" ] && [ "$4" = "--no-textconv" ] && [ "$5" = "--unified=0" ] && [ "$6" = "--no-color" ] && [ "$7" = "main...HEAD" ]; then
  cat <<'EOF'
diff --git a/src/feature.ts b/src/feature.ts
index 0123456..89abcde 100644
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1 +1,3 @@
+export function feature(): string {
+  return "next";
+}
EOF
  exit 0
fi
if [ "$1" = "status" ] && [ "$2" = "--porcelain=v1" ] && [ "$3" = "--untracked-files=all" ]; then
  exit 0
fi
if [ "$1" = "ls-remote" ]; then
  echo "unexpected remote check" 1>&2
  exit 99
fi
echo "unexpected git call: $@" 1>&2
exit 1
`,
      "utf-8",
    );
    chmodSync(fakeGitPath, 0o755);

    const previousPath = process.env.PATH;
    const previousCalls = process.env.GIT_CALLS_LOG;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    process.env.GIT_CALLS_LOG = callsPath;
    try {
      cmdPrMarkdown(tmpDir);
      const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
      expect(markdown).toContain("## PR Overview");
      expect(markdown).toContain("Base comparison: `main...HEAD`");
      const calls = readFileSync(callsPath, "utf-8");
      expect(calls).toContain("GIT_TERMINAL_PROMPT=0");
      expect(calls).toContain("GCM_INTERACTIVE=never");
      expect(calls).toContain("GH_PROMPT_DISABLED=1");
      expect(calls).not.toContain("ls-remote");
    } finally {
      process.env.PATH = previousPath;
      if (previousCalls === undefined) delete process.env.GIT_CALLS_LOG;
      else process.env.GIT_CALLS_LOG = previousCalls;
    }
  });
});
