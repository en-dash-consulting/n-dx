/**
 * Unit tests for the merge-history pipeline — pure parsing helpers and the
 * orchestrator function (driven through injected git/hench runners).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  parseSourceBranch,
  extractPrdIdsFromMessage,
  extractPrdIdFromBranch,
  mapNameStatus,
  parseNameStatusOutput,
  parseMergeLogOutput,
  summarizeFiles,
  flattenPrdItems,
  correlateHenchRunsToMerges,
  buildMergeGraph,
  MergeGraphCache,
  type GitRunner,
  type HenchRunSummary,
} from "../../../src/server/merge-history.js";
import type { PRDDocument } from "../../../src/server/rex-gateway.js";

const FS = "";
const RS = "";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function prdFixture(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "test",
    items: [
      {
        id: "aaaaaaaa-1111-2222-3333-444444444444",
        title: "Epic A",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "bbbbbbbb-1111-2222-3333-444444444444",
            title: "Feature B",
            level: "feature",
            status: "pending",
            children: [
              {
                id: "cccccccc-1111-2222-3333-444444444444",
                title: "Task C",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      },
      {
        id: "dddddddd-1111-2222-3333-444444444444",
        title: "Epic D",
        level: "epic",
        status: "pending",
        priority: "high",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Pure parsers
// ---------------------------------------------------------------------------

describe("mapNameStatus", () => {
  it("maps canonical git status codes", () => {
    expect(mapNameStatus("A")).toBe("added");
    expect(mapNameStatus("M")).toBe("modified");
    expect(mapNameStatus("D")).toBe("deleted");
    expect(mapNameStatus("R100")).toBe("renamed");
    expect(mapNameStatus("C80")).toBe("copied");
    expect(mapNameStatus("T")).toBe("typechange");
    expect(mapNameStatus("U")).toBe("unmerged");
    expect(mapNameStatus("X")).toBe("unknown");
    expect(mapNameStatus("")).toBe("unknown");
  });
});

describe("parseSourceBranch", () => {
  it("parses classic git merge subjects", () => {
    expect(parseSourceBranch("Merge branch 'feature/foo'")).toBe("feature/foo");
    expect(parseSourceBranch("Merge branch 'feature/foo' into main")).toBe("feature/foo");
  });

  it("parses remote-tracking merges, stripping the remote prefix", () => {
    expect(parseSourceBranch("Merge remote-tracking branch 'origin/feature/bar'"))
      .toBe("feature/bar");
  });

  it("parses GitHub pull-request subjects", () => {
    expect(parseSourceBranch("Merge pull request #42 from alice/fix-parser"))
      .toBe("fix-parser");
  });

  it("returns undefined for non-merge subjects", () => {
    expect(parseSourceBranch("fix: something")).toBeUndefined();
    expect(parseSourceBranch("")).toBeUndefined();
  });
});

describe("extractPrdIdsFromMessage", () => {
  const { knownIds } = flattenPrdItems(prdFixture());

  it("extracts known UUIDs from message text", () => {
    const msg = "Fixes aaaaaaaa-1111-2222-3333-444444444444 and dddddddd-1111-2222-3333-444444444444";
    const ids = extractPrdIdsFromMessage(msg, knownIds);
    expect(ids).toContain("aaaaaaaa-1111-2222-3333-444444444444");
    expect(ids).toContain("dddddddd-1111-2222-3333-444444444444");
    expect(ids).toHaveLength(2);
  });

  it("drops unknown UUIDs", () => {
    const msg = "Fixes 99999999-9999-9999-9999-999999999999";
    expect(extractPrdIdsFromMessage(msg, knownIds)).toEqual([]);
  });

  it("is case-insensitive but normalizes to lowercase matches", () => {
    const msg = "AAAAAAAA-1111-2222-3333-444444444444";
    expect(extractPrdIdsFromMessage(msg, knownIds)).toContain(
      "aaaaaaaa-1111-2222-3333-444444444444",
    );
  });

  it("returns empty for empty input", () => {
    expect(extractPrdIdsFromMessage("", knownIds)).toEqual([]);
  });
});

describe("extractPrdIdFromBranch", () => {
  const { knownIds, shortIdIndex } = flattenPrdItems(prdFixture());

  it("matches a full UUID embedded in a branch name", () => {
    expect(
      extractPrdIdFromBranch(
        "task/aaaaaaaa-1111-2222-3333-444444444444",
        knownIds,
        shortIdIndex,
      ),
    ).toBe("aaaaaaaa-1111-2222-3333-444444444444");
  });

  it("matches an 8-char UUID prefix in a branch segment", () => {
    expect(extractPrdIdFromBranch("task/bbbbbbbb-fix", knownIds, shortIdIndex))
      .toBe("bbbbbbbb-1111-2222-3333-444444444444");
  });

  it("returns undefined when no segment matches a known prefix", () => {
    expect(extractPrdIdFromBranch("feature/random-name", knownIds, shortIdIndex))
      .toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(extractPrdIdFromBranch("", knownIds, shortIdIndex)).toBeUndefined();
  });
});

describe("parseNameStatusOutput", () => {
  it("parses a batched git show --name-status output", () => {
    const stdout = [
      "__NDXSHA__ abc123",
      "A\tsrc/foo.ts",
      "M\tsrc/bar.ts",
      "D\tsrc/old.ts",
      "__NDXSHA__ def456",
      "R100\tsrc/was.ts\tsrc/now.ts",
      "C80\tsrc/src.ts\tsrc/copied.ts",
    ].join("\n");

    const result = parseNameStatusOutput(stdout);
    expect(result.get("abc123")).toEqual([
      { status: "added", path: "src/foo.ts" },
      { status: "modified", path: "src/bar.ts" },
      { status: "deleted", path: "src/old.ts" },
    ]);
    expect(result.get("def456")).toEqual([
      { status: "renamed", path: "src/now.ts", oldPath: "src/was.ts" },
      { status: "copied", path: "src/copied.ts", oldPath: "src/src.ts" },
    ]);
  });

  it("returns an empty map for empty input", () => {
    expect(parseNameStatusOutput("").size).toBe(0);
  });

  it("skips file status lines before the first marker", () => {
    const stdout = "M\tstray.ts\n__NDXSHA__ abc\nA\tnew.ts";
    const result = parseNameStatusOutput(stdout);
    expect(result.get("abc")).toEqual([{ status: "added", path: "new.ts" }]);
  });
});

describe("parseMergeLogOutput", () => {
  it("parses records separated by ASCII RS", () => {
    const rec1 = `abc123${FS}parent1 parent2${FS}2024-01-01T00:00:00Z${FS}alice${FS}Merge branch 'foo'${FS}Body of commit 1${RS}`;
    const rec2 = `def456${FS}parent3 parent4${FS}2024-02-02T00:00:00Z${FS}bob${FS}Merge pull request #1 from bob/bar${FS}Body line A\nBody line B${RS}`;
    const merges = parseMergeLogOutput(rec1 + "\n" + rec2);
    expect(merges).toHaveLength(2);
    expect(merges[0].sha).toBe("abc123");
    expect(merges[0].parents).toEqual(["parent1", "parent2"]);
    expect(merges[0].subject).toBe("Merge branch 'foo'");
    expect(merges[0].body).toBe("Body of commit 1");
    expect(merges[1].subject).toBe("Merge pull request #1 from bob/bar");
    expect(merges[1].body).toBe("Body line A\nBody line B");
  });

  it("returns an empty list for empty input", () => {
    expect(parseMergeLogOutput("")).toEqual([]);
  });
});

describe("summarizeFiles", () => {
  it("counts each status bucket plus total", () => {
    const summary = summarizeFiles([
      { status: "added", path: "a" },
      { status: "added", path: "b" },
      { status: "modified", path: "c" },
      { status: "deleted", path: "d" },
      { status: "renamed", path: "e", oldPath: "e0" },
      { status: "typechange", path: "f" },
    ]);
    expect(summary).toEqual({
      added: 2,
      modified: 1,
      deleted: 1,
      renamed: 1,
      copied: 0,
      other: 1,
      total: 6,
    });
  });
});

describe("flattenPrdItems", () => {
  it("walks the tree, assigning parentIds and building indexes", () => {
    const { nodes, knownIds, shortIdIndex } = flattenPrdItems(prdFixture());
    expect(nodes).toHaveLength(4);
    expect(knownIds.size).toBe(4);
    expect(shortIdIndex.get("aaaaaaaa")).toBe("aaaaaaaa-1111-2222-3333-444444444444");
    const taskC = nodes.find((n) => n.id.startsWith("cccccccc"));
    expect(taskC?.parentId).toBe("bbbbbbbb-1111-2222-3333-444444444444");
    const epicD = nodes.find((n) => n.id.startsWith("dddddddd"));
    expect(epicD?.parentId).toBeUndefined();
    expect(epicD?.priority).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// Hench-run correlation
// ---------------------------------------------------------------------------

describe("correlateHenchRunsToMerges", () => {
  const knownIds = new Set([
    "aaaaaaaa-1111-2222-3333-444444444444",
    "bbbbbbbb-1111-2222-3333-444444444444",
  ]);

  it("attributes runs within the time window to the next merge", () => {
    const merges = [
      { sha: "m2", mergedAt: "2024-01-02T10:00:00Z" },
      { sha: "m1", mergedAt: "2024-01-01T10:00:00Z" },
    ];
    const runs: HenchRunSummary[] = [
      {
        id: "r1",
        taskId: "aaaaaaaa-1111-2222-3333-444444444444",
        startedAt: "2024-01-02T09:00:00Z",
        finishedAt: "2024-01-02T09:30:00Z",
      },
    ];
    const windowMs = 24 * 60 * 60 * 1000;
    const out = correlateHenchRunsToMerges(merges, runs, knownIds, windowMs);
    expect(out.get("m2")).toEqual(new Set(["aaaaaaaa-1111-2222-3333-444444444444"]));
    expect(out.has("m1")).toBe(false);
  });

  it("stops at the previous merge to avoid double-attribution", () => {
    const merges = [
      { sha: "m2", mergedAt: "2024-01-02T10:00:00Z" },
      { sha: "m1", mergedAt: "2024-01-01T10:00:00Z" },
    ];
    const runs: HenchRunSummary[] = [
      {
        id: "r1",
        taskId: "aaaaaaaa-1111-2222-3333-444444444444",
        startedAt: "2024-01-01T09:00:00Z",
        finishedAt: "2024-01-01T09:30:00Z",
      },
    ];
    const windowMs = 10 * 24 * 60 * 60 * 1000; // 10 days — would overshoot into m2
    const out = correlateHenchRunsToMerges(merges, runs, knownIds, windowMs);
    expect(out.get("m1")).toEqual(new Set(["aaaaaaaa-1111-2222-3333-444444444444"]));
    expect(out.has("m2")).toBe(false);
  });

  it("drops runs with unknown taskIds", () => {
    const merges = [{ sha: "m1", mergedAt: "2024-01-01T10:00:00Z" }];
    const runs: HenchRunSummary[] = [
      {
        id: "r1",
        taskId: "99999999-9999-9999-9999-999999999999",
        startedAt: "2024-01-01T09:00:00Z",
        finishedAt: "2024-01-01T09:30:00Z",
      },
    ];
    const out = correlateHenchRunsToMerges(merges, runs, knownIds, 1_000_000);
    expect(out.size).toBe(0);
  });

  it("handles empty inputs gracefully", () => {
    expect(correlateHenchRunsToMerges([], [], knownIds, 100).size).toBe(0);
    const merges = [{ sha: "m1", mergedAt: "2024-01-01T10:00:00Z" }];
    expect(correlateHenchRunsToMerges(merges, [], knownIds, 100).size).toBe(0);
  });

  it("falls back to lastActivityAt / startedAt when finishedAt is absent", () => {
    const merges = [{ sha: "m1", mergedAt: "2024-01-01T10:00:00Z" }];
    const runs: HenchRunSummary[] = [
      {
        id: "r1",
        taskId: "aaaaaaaa-1111-2222-3333-444444444444",
        startedAt: "2024-01-01T09:00:00Z",
        lastActivityAt: "2024-01-01T09:30:00Z",
      },
    ];
    const out = correlateHenchRunsToMerges(merges, runs, knownIds, 3600_000 * 2);
    expect(out.get("m1")).toEqual(new Set(["aaaaaaaa-1111-2222-3333-444444444444"]));
  });
});

// ---------------------------------------------------------------------------
// End-to-end buildMergeGraph via injected runners
// ---------------------------------------------------------------------------

describe("buildMergeGraph (injected runners)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "merge-graph-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(join(tmpDir, ".rex", "prd.json"), JSON.stringify(prdFixture()));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeRunner(
    mergesStdout: string,
    nameStatusStdout: string,
    fingerprintResponses: Record<string, string> = {},
  ): GitRunner {
    return (args: string[]) => {
      if (args[0] === "log" && args.includes("--merges")) return mergesStdout;
      if (args[0] === "show") return nameStatusStdout;
      if (args[0] === "rev-list") {
        const key = args.join(" ");
        return fingerprintResponses[key] ?? "";
      }
      return "";
    };
  }

  it("builds a graph with commit-message and branch-name edges", () => {
    const aaa = "aaaaaaaa-1111-2222-3333-444444444444";
    const bbb = "bbbbbbbb-1111-2222-3333-444444444444";

    const merges =
      `sha_one${FS}p1${FS}2024-01-01T10:00:00Z${FS}alice${FS}Merge branch 'task/${aaa}-slug'${FS}Fixes nothing.${RS}` +
      "\n" +
      `sha_two${FS}p2${FS}2024-02-02T10:00:00Z${FS}bob${FS}Merge pull request #1 from user/unrelated${FS}Closes ${bbb}${RS}`;

    const fileChanges = [
      "__NDXSHA__ sha_one",
      "A\tsrc/a.ts",
      "M\tsrc/b.ts",
      "__NDXSHA__ sha_two",
      "D\tsrc/old.ts",
    ].join("\n");

    const runner = makeRunner(merges, fileChanges, {
      "rev-list --merges -n 1 HEAD": "sha_two\n",
      "rev-list --merges --count --max-count=500 HEAD": "2\n",
    });

    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [],
    });

    expect(graph.stats.merges).toBe(2);
    expect(graph.stats.mergesWithPrdLinkage).toBe(2);
    expect(graph.stats.mergesWithoutPrdLinkage).toBe(0);
    expect(graph.stats.prdItemsLinked).toBe(2);

    const mergeOne = graph.nodes.find(
      (n) => n.kind === "merge" && n.sha === "sha_one",
    );
    expect(mergeOne).toBeDefined();
    if (mergeOne && mergeOne.kind === "merge") {
      expect(mergeOne.sourceBranch).toBe(`task/${aaa}-slug`);
      expect(mergeOne.filesSummary.total).toBe(2);
      expect(mergeOne.files).toHaveLength(2);
    }

    // Both "commit-message" (UUID appears in the subject text itself) and
    // "branch-name" (UUID embedded in the merged branch) apply to sha_one —
    // both edges should be present.
    const sha1Branch = graph.edges.find(
      (e) => e.from === "sha_one" && e.to === aaa && e.attribution === "branch-name",
    );
    expect(sha1Branch).toBeDefined();

    const msgEdge = graph.edges.find(
      (e) => e.from === "sha_two" && e.to === bbb && e.attribution === "commit-message",
    );
    expect(msgEdge).toBeDefined();
  });

  it("reports merges with no PRD linkage in stats", () => {
    const merges = `sha_x${FS}p${FS}2024-01-01T00:00:00Z${FS}eve${FS}Merge branch 'cleanup'${FS}General cleanup.${RS}`;
    const files = "__NDXSHA__ sha_x\nM\tREADME.md";

    const runner = makeRunner(merges, files, {
      "rev-list --merges -n 1 HEAD": "sha_x\n",
      "rev-list --merges --count --max-count=500 HEAD": "1\n",
    });

    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [],
    });

    expect(graph.stats.merges).toBe(1);
    expect(graph.stats.mergesWithPrdLinkage).toBe(0);
    expect(graph.stats.mergesWithoutPrdLinkage).toBe(1);
    expect(graph.edges).toHaveLength(0);
  });

  it("correlates hench runs to the merge that follows them", () => {
    const aaa = "aaaaaaaa-1111-2222-3333-444444444444";
    const merges = `sha_m${FS}p${FS}2024-01-01T10:00:00Z${FS}alice${FS}Merge branch 'random'${FS}body${RS}`;
    const files = "__NDXSHA__ sha_m\nA\tnew.ts";

    const runner = makeRunner(merges, files, {
      "rev-list --merges -n 1 HEAD": "sha_m\n",
      "rev-list --merges --count --max-count=500 HEAD": "1\n",
    });

    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [
        {
          id: "r1",
          taskId: aaa,
          startedAt: "2024-01-01T09:00:00Z",
          finishedAt: "2024-01-01T09:45:00Z",
        },
      ],
    });

    const edge = graph.edges.find((e) => e.attribution === "hench-run");
    expect(edge?.from).toBe("sha_m");
    expect(edge?.to).toBe(aaa);
  });

  it("degrades gracefully when git is unavailable", () => {
    const runner: GitRunner = () => {
      throw new Error("not a git repo");
    };

    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [],
    });

    expect(graph.stats.merges).toBe(0);
    expect(graph.edges).toEqual([]);
    expect(graph.nodes.filter((n) => n.kind === "prd")).toHaveLength(4);
  });

  it("still emits prd nodes when PRD is empty", () => {
    const runner: GitRunner = () => "";
    const graph = buildMergeGraph({
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [],
      loadPRD: () => null,
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------

describe("MergeGraphCache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "merge-graph-cache-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await writeFile(join(tmpDir, ".rex", "prd.json"), JSON.stringify(prdFixture()));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the cached value until the fingerprint changes", () => {
    let buildCount = 0;
    const runner: GitRunner = (args) => {
      buildCount++;
      if (args[0] === "log") {
        return `sha1${FS}p${FS}2024-01-01T00:00:00Z${FS}alice${FS}Merge branch 'x'${FS}${RS}`;
      }
      if (args[0] === "show") return "__NDXSHA__ sha1\nA\tfoo.ts";
      if (args[0] === "rev-list") {
        const key = args.join(" ");
        if (key.endsWith("-n 1 HEAD")) return "sha1\n";
        if (key.includes("--count")) return "1\n";
      }
      return "";
    };

    const cache = new MergeGraphCache();
    const opts = {
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [],
    };

    const first = cache.get(opts);
    const callsAfterFirst = buildCount;
    const second = cache.get(opts);
    expect(second).toBe(first); // same object reference
    // Second call only runs fingerprint calls (2x rev-list), no log/show.
    expect(buildCount).toBeGreaterThan(callsAfterFirst);
  });

  it("rebuilds when the head merge sha changes", () => {
    let head = "sha1";
    const runner: GitRunner = (args) => {
      if (args[0] === "log") {
        return `${head}${FS}p${FS}2024-01-01T00:00:00Z${FS}alice${FS}Merge branch 'x'${FS}${RS}`;
      }
      if (args[0] === "show") return `__NDXSHA__ ${head}\nA\tfoo.ts`;
      if (args[0] === "rev-list") {
        const key = args.join(" ");
        if (key.endsWith("-n 1 HEAD")) return head + "\n";
        if (key.includes("--count")) return "1\n";
      }
      return "";
    };

    const cache = new MergeGraphCache();
    const opts = {
      projectDir: tmpDir,
      rexDir: join(tmpDir, ".rex"),
      henchRunsDir: join(tmpDir, ".hench", "runs"),
      gitRunner: runner,
      listHenchRuns: () => [],
    };

    const first = cache.get(opts);
    head = "sha2";
    const second = cache.get(opts);
    expect(second).not.toBe(first);
    expect(second.fingerprint.headMergeSha).toBe("sha2");
  });
});
