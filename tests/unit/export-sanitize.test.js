/**
 * `ndx export` must not publish agent transcripts by default.
 *
 * `.hench/runs/*.json` records carry `toolCalls[].input/output` (whatever the
 * agent read or printed — `.env` contents, `process.env` dumps, fixture data)
 * plus `events` and `error` bodies. `ndx export` used to copy every record
 * verbatim into the static site, and `--deploy=github` force-pushed it to
 * `origin`. These tests pin the pure helpers the export path is built on so
 * the guarantee does not depend on a built viewer to exercise.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sanitizeRunForExport,
  buildDeployManifest,
  formatDeployManifest,
  parseExportArgs,
} from "../../packages/core/export.js";

const SECRET = "sk-ant-api03-LEAKED-FROM-DOTENV";

/** A run record shaped like hench writes it, with a secret in the transcript. */
function fixtureRun() {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "Wire the thing",
    startedAt: "2026-09-11T10:00:00.000Z",
    finishedAt: "2026-09-11T10:05:00.000Z",
    status: "completed",
    turns: 3,
    summary: "Wired the thing.",
    error: `ENOENT while reading ${SECRET}`,
    tokenUsage: { input: 100, output: 50 },
    structuredSummary: { counts: { filesRead: 2, filesChanged: 1, commandsExecuted: 1, testsRun: 1, toolCallsTotal: 3 } },
    toolCalls: [
      { turn: 1, tool: "read_file", input: { path: ".env" }, output: `ANTHROPIC_API_KEY=${SECRET}`, durationMs: 3 },
    ],
    events: [{ type: "tool_result", vendor: "claude", turn: 1, timestamp: "…", toolResult: { tool: "read_file", output: SECRET, durationMs: 3 } }],
    diagnostics: { tokenDiagnosticStatus: "complete", parseMode: "stream", notes: [], promptSections: [{ name: "brief", chars: 10, text: SECRET }] },
    testGate: { ran: true, passed: false, packages: [], error: `vitest: ${SECRET}` },
    model: "claude-sonnet-5",
  };
}

describe("sanitizeRunForExport", () => {
  it("strips transcript-bearing fields by default", () => {
    const out = sanitizeRunForExport(fixtureRun());
    expect(out.toolCalls).toBeUndefined();
    expect(out.events).toBeUndefined();
    expect(out.error).toBeUndefined();
    expect(out.diagnostics.promptSections).toBeUndefined();
    expect(out.testGate.error).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it("keeps the metadata the static dashboard renders", () => {
    const out = sanitizeRunForExport(fixtureRun());
    expect(out.id).toBe("run-1");
    expect(out.status).toBe("completed");
    expect(out.summary).toBe("Wired the thing.");
    expect(out.tokenUsage).toEqual({ input: 100, output: 50 });
    expect(out.structuredSummary.counts.toolCallsTotal).toBe(3);
    expect(out.diagnostics.tokenDiagnosticStatus).toBe("complete");
    expect(out.testGate.passed).toBe(false);
  });

  it("marks the record so the viewer can say why the transcript is missing", () => {
    expect(sanitizeRunForExport(fixtureRun()).transcriptOmitted).toBe(true);
  });

  it("does not mutate its input", () => {
    const run = fixtureRun();
    sanitizeRunForExport(run);
    expect(run.toolCalls).toHaveLength(1);
    expect(run.diagnostics.promptSections).toHaveLength(1);
  });

  it("keeps everything when transcripts are explicitly included", () => {
    const run = fixtureRun();
    const out = sanitizeRunForExport(run, { includeTranscripts: true });
    expect(out.toolCalls).toEqual(run.toolCalls);
    expect(out.events).toEqual(run.events);
    expect(out.error).toBe(run.error);
    expect(out.transcriptOmitted).toBeUndefined();
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
