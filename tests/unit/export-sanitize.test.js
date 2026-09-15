/**
 * `ndx export` must not publish agent transcripts by default.
 *
 * A `.hench/runs/*.json` record carries the agent's raw activity: every
 * `toolCalls[].input/output`, the `events` stream, `error` bodies, raw
 * test-runner output, the literal command lines the agent ran, audit and
 * cleanup failure text. Any of those can carry whatever the agent read or
 * printed — `.env` contents, a `process.env` dump, an `Authorization:` header
 * typed into a `curl`. `ndx export` used to copy the record verbatim into the
 * static site, and `--deploy=github` force-pushes it to `origin`.
 *
 * The guarantee is an ALLOWLIST, so these tests are written against that
 * shape: the leak test below does not name the fields that must be stripped
 * (a denylist test goes stale the moment a field is added to `RunRecord`) but
 * pins the exact set of strings that are allowed to survive. A new free-text
 * field lands outside that set and fails here.
 *
 * The helpers are pinned directly rather than through the CLI so the guarantee
 * does not depend on a built viewer or a `rex` binary to exercise; the
 * assertions are made on `JSON.stringify(…, null, 2)` — byte-for-byte what
 * `runExport`'s `writeJSON` puts in `api/hench/runs/<id>.json` and
 * `api/hench/runs.json`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sanitizeRunForExport,
  summarizeRunForExport,
  buildDeployManifest,
  formatDeployManifest,
  parseExportArgs,
} from "../../packages/core/export.js";

const SECRET = "sk-ant-api03-LEAKED-FROM-DOTENV";

/**
 * A run record shaped like hench writes it, with the secret planted in every
 * free-text field of the schema — not only the ones the old denylist deleted.
 */
function fixtureRun() {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "Wire the thing",
    startedAt: "2026-09-11T10:00:00.000Z",
    finishedAt: "2026-09-11T10:05:00.000Z",
    lastActivityAt: "2026-09-11T10:04:59.000Z",
    status: "completed",
    turns: 3,
    summary: "Wired the thing.",
    error: `ENOENT while reading ${SECRET}`,
    model: "claude-sonnet-5",
    vendor: "claude",
    weight: "standard",
    ndxVersion: "0.6.0",
    // Absolute path on the operator's machine — deliberately not published.
    cliPath: "/Users/operator/src/n-dx/packages/core/cli.js",
    actor: "Jane Doe <jane@example.com>",
    host: "janes-laptop.local",
    invocationContext: "cli",
    assisted: false,
    tokenUsage: { input: 100, output: 50, cacheCreationInput: 10, cacheReadInput: 5 },
    tokens: { input: 100, output: 50, cached: 15, total: 165 },
    turnTokenUsage: [
      { turn: 1, input: 100, output: 50, vendor: "claude", model: "claude-sonnet-5", diagnosticStatus: "complete" },
    ],
    structuredSummary: {
      filesChanged: ["src/a.ts"],
      filesRead: ["src/b.ts"],
      commandsExecuted: [
        { command: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com`, exitStatus: "ok", durationMs: 12 },
      ],
      testsRun: [
        { command: `pnpm test --reporter=json # ${SECRET}`, passed: true, durationMs: 90 },
      ],
      postRunTests: {
        ran: true,
        passed: false,
        command: "pnpm test",
        output: `FAIL tests/a.test.ts\n  env dump: ANTHROPIC_API_KEY=${SECRET}`,
        durationMs: 100,
        targetedFiles: ["tests/a.test.ts"],
        error: `could not spawn pnpm: ${SECRET}`,
      },
      fileChangesWithStatus: ["M\tsrc/a.ts"],
      counts: { filesRead: 2, filesChanged: 1, commandsExecuted: 1, testsRun: 1, toolCallsTotal: 3 },
    },
    toolCalls: [
      { turn: 1, tool: "read_file", input: { path: ".env" }, output: `ANTHROPIC_API_KEY=${SECRET}`, durationMs: 3 },
    ],
    events: [
      { type: "tool_result", vendor: "claude", turn: 1, timestamp: "2026-09-11T10:01:00.000Z", toolResult: { tool: "read_file", output: SECRET, durationMs: 3 } },
    ],
    diagnostics: {
      tokenDiagnosticStatus: "complete",
      parseMode: "stream-json",
      notes: [`codex_usage_missing: ${SECRET}`],
      promptSections: [{ name: "brief", byteLength: 10 }],
      vendor: "claude",
      sandbox: "workspace-write",
      approvals: "never",
    },
    testGate: {
      ran: true,
      passed: false,
      packages: [
        { name: "packages/hench", passed: false, testCount: 64, failureCount: 1, failureOutput: `AssertionError: expected ${SECRET}`, durationMs: 900 },
      ],
      command: "pnpm test",
      totalDurationMs: 1000,
      error: `vitest: ${SECRET}`,
    },
    dependencyAudit: {
      ran: false,
      skipped: false,
      startedAt: "2026-09-11T10:00:01.000Z",
      finishedAt: "2026-09-11T10:00:02.000Z",
      totalDurationMs: 1000,
      vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, packages: [] },
      outdated: { major: [], minor: [], patch: [] },
      perPackage: [],
      commands: {
        audit: { command: "pnpm audit --json", exitCode: null, ran: false, error: `spawn ENOENT ${SECRET}` },
        outdated: { command: "pnpm outdated --json", exitCode: null, ran: false, error: `spawn ENOENT ${SECRET}` },
      },
      error: `audit inconclusive: ${SECRET}`,
    },
    cleanupTransformations: {
      ran: true,
      appliedCount: 0,
      rolledBackCount: 1,
      batches: [
        {
          transformations: [
            { type: "unused_import_prune", file: "src/a.ts", startLine: 1, endLine: 2, description: "prune import", removedCode: `const key = "${SECRET}";` },
          ],
          validated: false,
          rolledBack: true,
          error: `tsc: ${SECRET}`,
        },
      ],
      totalDurationMs: 40,
      error: `cleanup failed: ${SECRET}`,
    },
    review: {
      model: "opus",
      resumedSession: true,
      findingCount: 2,
      unresolvedCount: 1,
      unrepairedMustFixCount: 0,
      failedActionCount: 1,
      fixesApplied: true,
      reportPath: `/Users/operator/.hench/review-${SECRET}.json`,
      repairedFiles: ["src/a.ts"],
    },
    memoryStats: { peakRssBytes: 1, systemAvailableAtStartBytes: 2, systemAvailableAtEndBytes: 3, systemTotalBytes: 4 },
  };
}

// ── String-leaf walking ──────────────────────────────────────────────────────
// The leak test replaces every string leaf of the fixture with a sentinel
// naming its own path, then asserts on the exact set of sentinels that survive.

const MARK = "LEAK::";

/** Deep copy of `value` with every string leaf replaced by `LEAK::<path>`. */
function withSentinels(value, path = "") {
  if (typeof value === "string") return `${MARK}${path}`;
  if (Array.isArray(value)) return value.map((v, i) => withSentinels(v, path ? `${path}.${i}` : String(i)));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, withSentinels(v, path ? `${path}.${k}` : k)]),
    );
  }
  return value;
}

/** Every string leaf anywhere in `value`. */
function stringLeaves(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringLeaves);
  return [];
}

/** Sorted source paths of the sentinels that survived into `published`. */
function survivingPaths(published) {
  return stringLeaves(published)
    .filter((s) => s.startsWith(MARK))
    .map((s) => s.slice(MARK.length))
    .sort();
}

/**
 * The only strings `ndx export` may carry out of a run record.
 *
 * Every entry is a field the deployed viewer renders (`RunSummary` /
 * `RunDetail` in `packages/web/src/viewer/views/hench-runs.ts`). Adding to
 * this list is the review point for publishing more of a run.
 */
const PUBLISHED_DETAIL_PATHS = [
  "diagnostics.approvals",
  "diagnostics.parseMode",
  "diagnostics.sandbox",
  "diagnostics.tokenDiagnosticStatus",
  "diagnostics.vendor",
  "finishedAt",
  "id",
  "invocationContext",
  "lastActivityAt",
  "model",
  "ndxVersion",
  "review.model",
  "startedAt",
  "status",
  "structuredSummary.fileChangesWithStatus.0",
  "summary",
  "taskId",
  "taskTitle",
  "turnTokenUsage.0.diagnosticStatus",
  "turnTokenUsage.0.model",
  "turnTokenUsage.0.vendor",
  "vendor",
  "weight",
].sort();

const PUBLISHED_INDEX_PATHS = [
  "diagnostics.tokenDiagnosticStatus",
  "finishedAt",
  "id",
  "invocationContext",
  "lastActivityAt",
  "model",
  "startedAt",
  "status",
  "summary",
  "taskId",
  "taskTitle",
  "vendor",
].sort();

/** What `runExport` writes to `api/hench/runs.json`. */
function indexFile(runs, opts) {
  const entries = runs.map((r) => summarizeRunForExport(r, opts));
  return JSON.stringify({ runs: entries, total: entries.length }, null, 2);
}

/** What `runExport` writes to `api/hench/runs/<id>.json`. */
function detailFile(run, opts) {
  return JSON.stringify(sanitizeRunForExport(run, opts), null, 2);
}

describe("exported run records", () => {
  it("publish no free-text field of the record by default", () => {
    const run = fixtureRun();

    expect(detailFile(run, {})).not.toContain(SECRET);
    expect(indexFile([run], {})).not.toContain(SECRET);
  });

  it("publish only allowlisted strings — every other string leaf is dropped", () => {
    // Sanity: the fixture really does reach every corner of the record.
    const planted = survivingPaths(withSentinels(fixtureRun()));
    expect(planted.length).toBeGreaterThan(40);
    expect(planted).toContain("testGate.packages.0.failureOutput");
    expect(planted).toContain("structuredSummary.postRunTests.output");
    expect(planted).toContain("structuredSummary.commandsExecuted.0.command");
    expect(planted).toContain("dependencyAudit.commands.audit.error");
    expect(planted).toContain("cleanupTransformations.batches.0.error");
    expect(planted).toContain("diagnostics.notes.0");

    const sentinelRun = withSentinels(fixtureRun());
    expect(survivingPaths(sanitizeRunForExport(sentinelRun))).toEqual(PUBLISHED_DETAIL_PATHS);
    expect(survivingPaths(summarizeRunForExport(sentinelRun))).toEqual(PUBLISHED_INDEX_PATHS);
  });

  it("keep the metadata the static dashboard renders", () => {
    const out = sanitizeRunForExport(fixtureRun());
    expect(out.id).toBe("run-1");
    expect(out.status).toBe("completed");
    expect(out.turns).toBe(3);
    expect(out.summary).toBe("Wired the thing.");
    expect(out.model).toBe("claude-sonnet-5");
    expect(out.ndxVersion).toBe("0.6.0");
    expect(out.invocationContext).toBe("cli");
    expect(out.tokenUsage).toEqual({ input: 100, output: 50, cacheCreationInput: 10, cacheReadInput: 5 });
    expect(out.tokens).toEqual({ input: 100, output: 50, cached: 15, total: 165 });
    expect(out.structuredSummary.counts.toolCallsTotal).toBe(3);
    expect(out.structuredSummary.fileChangesWithStatus).toEqual(["M\tsrc/a.ts"]);
    expect(out.diagnostics.tokenDiagnosticStatus).toBe("complete");
    expect(out.diagnostics.vendor).toBe("claude");
    expect(out.testGate.passed).toBe(false);
    expect(out.testGate.ran).toBe(true);
    expect(out.review.unrepairedMustFixCount).toBe(0);
  });

  it("omit the operator's identity and machine paths, which nothing renders", () => {
    const out = sanitizeRunForExport(fixtureRun());
    expect(out.actor).toBeUndefined();
    expect(out.host).toBeUndefined();
    expect(out.cliPath).toBeUndefined();
  });

  it("mark both surfaces so the viewer can say why the transcript is missing", () => {
    expect(sanitizeRunForExport(fixtureRun()).transcriptOmitted).toBe(true);
    expect(summarizeRunForExport(fixtureRun()).transcriptOmitted).toBe(true);
  });

  it("do not mutate their input", () => {
    const run = fixtureRun();
    sanitizeRunForExport(run);
    summarizeRunForExport(run);
    expect(run.toolCalls).toHaveLength(1);
    expect(run.diagnostics.promptSections).toHaveLength(1);
    expect(run.testGate.error).toBe(`vitest: ${SECRET}`);
    expect(run.structuredSummary.commandsExecuted).toHaveLength(1);
  });

  it("carry the full record when transcripts are explicitly included", () => {
    const run = fixtureRun();
    const out = sanitizeRunForExport(run, { includeTranscripts: true });
    expect(out.toolCalls).toEqual(run.toolCalls);
    expect(out.events).toEqual(run.events);
    expect(out.error).toBe(run.error);
    expect(out.testGate.packages[0].failureOutput).toBe(run.testGate.packages[0].failureOutput);
    expect(out.transcriptOmitted).toBeUndefined();
    expect(detailFile(run, { includeTranscripts: true })).toContain(SECRET);

    // The index stays a summary, but its one transcript-bearing field is back.
    expect(summarizeRunForExport(run, { includeTranscripts: true }).error).toBe(run.error);
    expect(indexFile([run], { includeTranscripts: true })).toContain(SECRET);
  });

  it("build an index entry the runs list can render", () => {
    const entry = summarizeRunForExport(fixtureRun());
    expect(entry.id).toBe("run-1");
    expect(entry.taskId).toBe("task-1");
    expect(entry.taskTitle).toBe("Wire the thing");
    expect(entry.turns).toBe(3);
    expect(entry.vendor).toBe("claude");
    expect(entry.tokenDiagnosticStatus).toBe("complete");
    expect(entry.tokenUsage).toEqual({ input: 100, output: 50, cacheCreationInput: 10, cacheReadInput: 5 });
    expect(entry.structuredSummary).toEqual({
      counts: { filesRead: 2, filesChanged: 1, commandsExecuted: 1, testsRun: 1, toolCallsTotal: 3 },
    });
    expect(entry.error).toBeUndefined();
  });

  it("survive a sparse record without inventing fields", () => {
    const minimal = { id: "run-2", startedAt: "2026-09-11T10:00:00.000Z", status: "running" };
    const out = sanitizeRunForExport(minimal);
    expect(out).toEqual({ id: "run-2", startedAt: "2026-09-11T10:00:00.000Z", status: "running", transcriptOmitted: true });

    const entry = summarizeRunForExport(minimal);
    expect(entry.turns).toBe(0);
    expect(entry.tokenUsage).toEqual({ input: 0, output: 0, cacheCreationInput: undefined, cacheReadInput: undefined });
    expect(entry.structuredSummary).toBeUndefined();
  });
});

describe("parseExportArgs", () => {
  it("recognises --include-transcripts and --yes, both off by default", () => {
    const off = parseExportArgs(["--base-path=/x/", "."]);
    expect(off.includeTranscripts).toBe(false);
    expect(off.yes).toBe(false);

    const on = parseExportArgs(["--include-transcripts", "--yes", "--base-path=/x/", "."]);
    expect(on.includeTranscripts).toBe(true);
    expect(on.yes).toBe(true);
  });
});

describe("buildDeployManifest", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-export-manifest-"));
    await mkdir(join(dir, ".hench", "runs"), { recursive: true });
    await writeFile(join(dir, ".hench", "runs", "a.json"), "{}");
    await writeFile(join(dir, ".hench", "runs", "b.json"), "{}");
    await writeFile(join(dir, ".hench", "runs", "notes.txt"), "");
    await mkdir(join(dir, ".rex", "prd_tree", "epic-one", "feature"), { recursive: true });
    await writeFile(join(dir, ".rex", "prd_tree", "epic-one", "index.md"), "---\nid: e1\n---\n");
    await writeFile(join(dir, ".rex", "prd_tree", "epic-one", "feature", "index.md"), "---\nid: f1\n---\n");
    await writeFile(join(dir, ".rex", "prd_tree", "epic-one", "feature", "task.md"), "---\nid: t1\n---\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("counts runs and PRD items and reports the transcript decision", () => {
    const m = buildDeployManifest(dir, { includeTranscripts: false });
    expect(m.branch).toBe("n-dx-dashboard");
    expect(m.runCount).toBe(2);
    expect(m.itemCount).toBe(3);
    expect(m.includeTranscripts).toBe(false);
    // Not a git repo — no remote to name, but the manifest must still build.
    expect(m.remote).toBeNull();
  });

  it("formats a manifest that names what will be published", () => {
    const text = formatDeployManifest(buildDeployManifest(dir, { includeTranscripts: false })).join("\n");
    expect(text).toContain("n-dx-dashboard");
    expect(text).toContain("2 hench run");
    expect(text).toContain("3 PRD item");
    expect(text).toMatch(/transcripts?:\s*(excluded|not included)/i);

    const withTranscripts = formatDeployManifest(buildDeployManifest(dir, { includeTranscripts: true })).join("\n");
    expect(withTranscripts).toMatch(/transcripts?:\s*INCLUDED/i);
  });
});
