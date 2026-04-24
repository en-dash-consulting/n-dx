/**
 * Integration tests for the merge-history pipeline against a real git repo.
 *
 * Builds a throwaway git repository with a handful of branch-and-merge cycles
 * that exercise each correlation strategy, then verifies the full pipeline
 * produces the expected graph payload end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildMergeGraph,
  createGitRunner,
  MergeGraphCache,
  type HenchRunSummary,
} from "../../src/server/merge-history.js";

const AAA = "aaaaaaaa-1111-2222-3333-444444444444";
const BBB = "bbbbbbbb-1111-2222-3333-444444444444";
const CCC = "cccccccc-1111-2222-3333-444444444444";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

describe("merge-history pipeline (integration)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "merge-pipeline-"));

    // Init repo with deterministic defaults
    git(tmpDir, ["init", "--initial-branch=main", "-q"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test"]);
    git(tmpDir, ["config", "commit.gpgsign", "false"]);

    // PRD fixture
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Integration",
        items: [
          { id: AAA, title: "Epic A", level: "epic", status: "pending" },
          { id: BBB, title: "Epic B", level: "epic", status: "pending" },
          { id: CCC, title: "Epic C", level: "epic", status: "pending" },
        ],
      }),
    );

    // Initial commit
    await writeFile(join(tmpDir, "README.md"), "# hi\n");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "initial", "-q"]);

    // ── Merge 1: branch-name correlation (branch contains full UUID) ──────
    git(tmpDir, ["checkout", "-b", `task/${AAA}`, "-q"]);
    await writeFile(join(tmpDir, "a.ts"), "export const a = 1;\n");
    git(tmpDir, ["add", "a.ts"]);
    git(tmpDir, ["commit", "-m", "add a", "-q"]);
    git(tmpDir, ["checkout", "main", "-q"]);
    git(tmpDir, ["merge", "--no-ff", `task/${AAA}`, "-m", `Merge branch 'task/${AAA}'`, "-q"]);

    // ── Merge 2: commit-message correlation (UUID in body) ────────────────
    git(tmpDir, ["checkout", "-b", "cleanup", "-q"]);
    await writeFile(join(tmpDir, "b.ts"), "export const b = 2;\n");
    git(tmpDir, ["add", "b.ts"]);
    git(tmpDir, ["commit", "-m", "add b", "-q"]);
    await writeFile(join(tmpDir, "b.ts"), "export const b = 3;\n");
    git(tmpDir, ["add", "b.ts"]);
    git(tmpDir, ["commit", "-m", "tweak b", "-q"]);
    git(tmpDir, ["checkout", "main", "-q"]);
    git(tmpDir, [
      "merge",
      "--no-ff",
      "cleanup",
      "-m",
      `Merge branch 'cleanup'\n\nRefs ${BBB}`,
      "-q",
    ]);

    // ── Merge 3: no PRD linkage ──────────────────────────────────────────
    git(tmpDir, ["checkout", "-b", "misc", "-q"]);
    await writeFile(join(tmpDir, "c.ts"), "export const c = 3;\n");
    git(tmpDir, ["add", "c.ts"]);
    git(tmpDir, ["commit", "-m", "add c", "-q"]);
    git(tmpDir, ["checkout", "main", "-q"]);
    git(tmpDir, ["merge", "--no-ff", "misc", "-m", "Merge branch 'misc'", "-q"]);
  });

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces merge nodes + edges with real git + PRD inputs", () => {
    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: createGitRunner(tmpDir),
      listHenchRuns: () => [],
    });

    expect(graph.stats.merges).toBe(3);
    expect(graph.stats.mergesWithPrdLinkage).toBe(2);
    expect(graph.stats.mergesWithoutPrdLinkage).toBe(1);

    const branchEdges = graph.edges.filter((e) => e.attribution === "branch-name");
    const messageEdges = graph.edges.filter((e) => e.attribution === "commit-message");

    expect(branchEdges.find((e) => e.to === AAA)).toBeDefined();
    expect(messageEdges.find((e) => e.to === BBB)).toBeDefined();

    // Verify file-change summary for the first merge
    const firstMerge = graph.nodes.find(
      (n) => n.kind === "merge" && n.subject.includes(`task/${AAA}`),
    );
    expect(firstMerge).toBeDefined();
    if (firstMerge && firstMerge.kind === "merge") {
      expect(firstMerge.filesSummary.total).toBeGreaterThan(0);
      expect(firstMerge.filesSummary.added).toBeGreaterThan(0);
      expect(firstMerge.files.map((f) => f.path)).toContain("a.ts");
    }

    // PRD nodes present for all fixture items
    const prdIds = graph.nodes
      .filter((n) => n.kind === "prd")
      .map((n) => n.id);
    expect(prdIds).toContain(AAA);
    expect(prdIds).toContain(BBB);
    expect(prdIds).toContain(CCC);
  });

  it("correlates hench runs via time windows", () => {
    // Pick a merge timestamp from the real repo by inspecting the log
    const log = execFileSync(
      "git",
      ["log", "--merges", "-n", "1", "--pretty=format:%cI"],
      { cwd: tmpDir, encoding: "utf-8" },
    ).trim();
    const headMergeTime = Date.parse(log);
    const runFinished = new Date(headMergeTime - 60 * 1000).toISOString();
    const runStarted = new Date(headMergeTime - 10 * 60 * 1000).toISOString();

    const runs: HenchRunSummary[] = [
      {
        id: "r1",
        taskId: CCC,
        startedAt: runStarted,
        finishedAt: runFinished,
      },
    ];

    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: createGitRunner(tmpDir),
      listHenchRuns: () => runs,
    });

    const henchEdge = graph.edges.find((e) => e.attribution === "hench-run");
    expect(henchEdge?.to).toBe(CCC);
  });

  it("caches the payload and invalidates when head merge changes", async () => {
    const cache = new MergeGraphCache();
    const opts = {
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: createGitRunner(tmpDir),
      listHenchRuns: () => [],
    };

    const first = cache.get(opts);
    const second = cache.get(opts);
    expect(second).toBe(first);

    // Land a new merge → fingerprint changes → cache rebuilds
    git(tmpDir, ["checkout", "-b", "extra", "-q"]);
    await writeFile(join(tmpDir, "extra.ts"), "export const e = 1;\n");
    git(tmpDir, ["add", "extra.ts"]);
    git(tmpDir, ["commit", "-m", "add extra", "-q"]);
    git(tmpDir, ["checkout", "main", "-q"]);
    git(tmpDir, ["merge", "--no-ff", "extra", "-m", "Merge branch 'extra'", "-q"]);

    const third = cache.get(opts);
    expect(third).not.toBe(first);
    expect(third.stats.merges).toBe(first.stats.merges + 1);
  });
});
