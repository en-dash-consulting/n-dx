/**
 * `createPacketSources` derives the provenance paths a packet shows from the
 * workspace's resolved layout. The packet tests stub `sourcePaths`, so these
 * pin the production values: project-relative, forward slashes, trailing slash
 * on the runs directory, on both layouts.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPrdModel } from "../../../src/server/rex-gateway.js";
import { prepareReads, sidecarContextOptions } from "../../../src/server/routes-sidecar.js";
import { buildDescribePacket } from "../../../src/server/sidecar/packet-builders.js";
import { createPacketSources, type SpawnedReads } from "../../../src/server/sidecar/packet-sources.js";
import type { SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";

const spawned: SpawnedReads = {
  resolve: async () => null,
  preview: async () => null,
  diagnose: async () => null,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sidecar-packet-sources-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function contextFor(projectDir: string, stateDir: (name: string) => string): ServerContext {
  return {
    projectDir,
    svDir: stateDir("sourcevision"),
    rexDir: stateDir("rex"),
    dev: false,
  };
}

describe("createPacketSources sourcePaths", () => {
  it("names the legacy dot-directories", () => {
    const ctx = contextFor(dir, (name) => join(dir, `.${name}`));
    expect(createPacketSources(ctx, spawned).sourcePaths).toEqual({
      zones: ".sourcevision/zones.json",
      runs: ".hench/runs/",
    });
  });

  it("names the container-relative paths on the .ndx layout", () => {
    mkdirSync(join(dir, ".ndx"));
    const ctx = contextFor(dir, (name) => join(dir, ".ndx", name));
    expect(createPacketSources(ctx, spawned).sourcePaths).toEqual({
      zones: ".ndx/sourcevision/zones.json",
      runs: ".ndx/hench/runs/",
    });
  });
});

describe("createPacketSources runs", () => {
  const TASK = "c0000000-0000-4000-8000-000000000002";
  const record = (id: string, taskId: string, startedAt: string) => ({ id, taskId, status: "completed", startedAt });

  function seedRuns(): ServerContext {
    const runs = join(dir, ".hench", "runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "live-run.json"), JSON.stringify(record("live-run", TASK, "2026-10-10T08:00:00.000Z")));
    writeFileSync(join(runs, "old-run.json.gz"), gzipSync(JSON.stringify(record("old-run", TASK, "2026-09-01T08:00:00.000Z"))));
    writeFileSync(join(runs, "other-run.json.gz"), gzipSync(JSON.stringify(record("other-run", "someone-else", "2026-09-02T08:00:00.000Z"))));
    return contextFor(dir, (name) => join(dir, `.${name}`));
  }

  it("returns plain and gzipped records of the task, newest first", async () => {
    const runs = await createPacketSources(seedRuns(), spawned).runs(TASK);
    expect(runs?.map((r) => r.id)).toEqual(["live-run", "old-run"]);
  });

  it("lists a run caught mid-archive once, and skips an entry that vanished before its stat", async () => {
    const ctx = seedRuns();
    const runs = join(dir, ".hench", "runs");
    writeFileSync(join(runs, "live-run.json.gz"), gzipSync(JSON.stringify(record("live-run", TASK, "2026-10-10T08:00:00.000Z"))));
    if (process.platform !== "win32") symlinkSync(join(runs, "gone.json"), join(runs, "dangling.json"));
    const listed = await createPacketSources(ctx, spawned).runs(TASK);
    expect(listed?.map((r) => r.id)).toEqual(["live-run", "old-run"]);
  });

  it("lists an archived-only task's run in the Describe packet", async () => {
    const ctx = seedRuns();
    rmSync(join(dir, ".hench", "runs", "live-run.json"));
    const rexDir = join(dir, ".rex");
    cpSync(resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree"), rexDir, { recursive: true });
    const model = await loadPrdModel(rexDir);
    const sources = {
      ...createPacketSources(ctx, spawned),
      prd: async () => ({ layout: model.layout, tree: model.tree }),
    };
    const packet = await buildDescribePacket(sources, { ref: TASK }, "2026-10-28T12:00:00.000Z");
    expect(packet.text).toContain("old-run");
    expect(packet.text).not.toContain("No run of this task is recorded.");
  });
});

describe("createPacketSources taskRun", () => {
  const TASK = "c0000000-0000-4000-8000-000000000002";
  const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const diagnosis = {
    class: "review-blocked",
    summary: "The review left 1 must-fix finding(s) unrepaired.",
    evidence: ["review.unrepairedMustFixCount: 1"],
    actions: [{ kind: "follow-up-run", label: "Follow-up run with the review findings in the brief" }],
    attempt: { n: 1, of: 2 },
  };

  function seed(newest: Record<string, unknown>): ServerContext {
    const hench = join(dir, ".hench");
    mkdirSync(join(hench, "runs"), { recursive: true });
    mkdirSync(join(hench, "reviews"), { recursive: true });
    writeFileSync(join(hench, "runs", "older.json"), JSON.stringify({ id: "older", taskId: TASK, status: "failed", startedAt: "2026-10-01T08:00:00.000Z" }));
    writeFileSync(join(hench, "runs", "newest.json"), JSON.stringify({ id: "newest", taskId: TASK, startedAt: "2026-10-20T08:00:00.000Z", ...newest }));
    return contextFor(dir, (name) => join(dir, `.${name}`));
  }

  it("reads the task's newest run: verdict, gate digest, unrepaired findings and last events, redacted", async () => {
    const ctx = seed({
      status: "failed",
      finishedAt: "2026-10-20T08:30:00.000Z",
      error: `Gate failed\nsecond line`,
      diagnosis,
      testGate: { ran: true, passed: false, command: "pnpm test", failureDigest: `FAIL a.test.ts\ntoken ${SECRET}`, outputTail: "tail only" },
    });
    writeFileSync(join(dir, ".hench", "reviews", "newest.json"), JSON.stringify({
      taskId: TASK,
      summary: "Attacked it.",
      fixesApplied: false,
      findings: [
        { title: "Open must-fix", verdict: "must-fix", action: "captured", severity: "high", location: "a.ts:1" },
        { title: "Fixed must-fix", verdict: "must-fix", action: "fixed" },
        { title: "Failed should-fix", verdict: "should-fix", action: "failed" },
        { title: "Dropped nit", verdict: "not-worth-fixing", action: "dropped" },
      ],
    }));
    const events = Array.from({ length: 30 }, (_, i) => JSON.stringify({ kind: "tests_run", at: `2026-10-20T08:${String(i).padStart(2, "0")}:00.000Z`, summary: `event ${i}` }));
    writeFileSync(join(dir, ".hench", "runs", "newest.events.jsonl"), `${events.join("\n")}\n`);

    const read = await createPacketSources(ctx, spawned).taskRun(TASK);
    expect(read?.run).toEqual({
      id: "newest",
      status: "failed",
      startedAt: "2026-10-20T08:00:00.000Z",
      finishedAt: "2026-10-20T08:30:00.000Z",
      error: "Gate failed",
      path: ".hench/runs/newest.json",
    });
    expect(read?.diagnosis).toEqual(diagnosis);
    expect(read?.gate).toMatchObject({ ran: true, passed: false, command: "pnpm test", textKind: "failure digest", cutChars: 0 });
    expect(read?.gate?.text).toContain("FAIL a.test.ts");
    expect(read?.gate?.text).not.toContain(SECRET);
    expect(read?.review?.path).toBe(".hench/reviews/newest.json");
    expect(read?.review?.total).toBe(4);
    expect(read?.review?.unrepaired.map((f) => f.title)).toEqual(["Open must-fix", "Failed should-fix"]);
    expect(read?.events?.path).toBe(".hench/runs/newest.events.jsonl");
    expect(read?.events?.last.map((e) => e.summary)).toEqual(Array.from({ length: 12 }, (_, i) => `event ${i + 18}`));
  });

  it("keeps only the end of a long gate text, from a line start, and says how much was cut", async () => {
    const long = Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
    const read = await createPacketSources(seed({ status: "failed", testGate: { ran: true, passed: false, outputTail: long } }), spawned).taskRun(TASK);
    expect(read?.gate?.textKind).toBe("output tail");
    expect(read!.gate!.text!.length).toBeLessThanOrEqual(2_400);
    expect(read!.gate!.text!.startsWith("line ")).toBe(true);
    expect(read!.gate!.text!.endsWith("line 399 " + "x".repeat(20))).toBe(true);
    expect(read!.gate!.cutChars).toBe(long.length - read!.gate!.text!.length);
  });

  it("keeps the start of a long failure digest, where its failing tests are listed, at a line end", async () => {
    const digest = [
      "Failing tests:",
      "  FAIL src/pay/button.test.ts > renders",
      ...Array.from({ length: 200 }, (_, i) => `  assertion line ${i} ${"x".repeat(20)}`),
      "Suite summary:",
    ].join("\n");
    const read = await createPacketSources(seed({ status: "failed", testGate: { ran: true, passed: false, failureDigest: digest, outputTail: "tail" } }), spawned).taskRun(TASK);
    expect(read?.gate?.textKind).toBe("failure digest");
    expect(read!.gate!.text!.length).toBeLessThanOrEqual(2_400);
    expect(read!.gate!.text!.startsWith("Failing tests:\n  FAIL src/pay/button.test.ts > renders")).toBe(true);
    expect(digest.startsWith(`${read!.gate!.text!}\n`)).toBe(true);
    expect(read!.gate!.cutChars).toBe(digest.length - read!.gate!.text!.length);
  });

  it("carries no gate text for a gate that passed, and nulls for what the run did not record", async () => {
    const read = await createPacketSources(seed({ status: "completed", testGate: { ran: true, passed: true, outputTail: "ok" } }), spawned).taskRun(TASK);
    expect(read?.diagnosis).toBeNull();
    expect(read?.gate).toMatchObject({ passed: true, text: null, textKind: null });
    expect(read?.review).toBeNull();
    expect(read?.events).toBeNull();
  });

  it("carries the settings a re-run repeats: a flag's model, and the review plan", async () => {
    const flagged = await createPacketSources(
      seed({
        status: "failed",
        model: "claude-opus-4-7",
        modelSource: "cli-flag",
        reviewPlan: { mode: "self", model: "claude-sonnet-5-5", modelSource: "flag", optional: false },
      }),
      spawned,
    ).taskRun(TASK);
    expect(flagged?.settings).toEqual({ model: "claude-opus-4-7", review: true, reviewModel: "claude-sonnet-5-5" });
    // A configured model is the project's to resolve again; a run with no review plan had no review.
    const configured = await createPacketSources(seed({ status: "failed", model: "sonnet", modelSource: "hench.models.claude" }), spawned).taskRun(TASK);
    expect(configured?.settings).toEqual({});
  });

  it("reads null when no run of the task is recorded", async () => {
    expect(await createPacketSources(contextFor(dir, (name) => join(dir, `.${name}`)), spawned).taskRun(TASK)).toBeNull();
  });
});

describe("createPacketSources zone", () => {
  function withAnalysis(): ServerContext {
    const ctx = contextFor(dir, (name) => join(dir, `.${name}`));
    mkdirSync(ctx.svDir, { recursive: true });
    writeFileSync(join(ctx.svDir, "manifest.json"), JSON.stringify({ analyzedAt: "2026-10-21T00:00:00.000Z" }));
    writeFileSync(
      join(ctx.svDir, "zones.json"),
      JSON.stringify({
        zones: [
          {
            id: "pay-2",
            previousIds: ["pay"],
            name: "Payments",
            description: "Card and wallet payment.",
            files: Array.from({ length: 30 }, (_, i) => `src/pay/f${i}.ts`),
            entryPoints: ["src/pay/index.ts"],
            cohesion: 0.8,
            coupling: 0.2,
            insights: ["Shared with refunds."],
          },
        ],
      }),
    );
    return ctx;
  }

  it("finds a zone by id, an id it was known by, or its name, and bounds the file sample", async () => {
    const sources = createPacketSources(withAnalysis(), spawned);
    for (const ref of ["pay-2", "pay", "payments"]) {
      const zone = await sources.zone(ref);
      expect(zone).toMatchObject({ id: "pay-2", name: "Payments", fileCount: 30, cohesion: 0.8, coupling: 0.2, analyzedAt: "2026-10-21T00:00:00.000Z" });
      expect(zone?.files).toHaveLength(20);
      expect(zone?.insights).toEqual(["Shared with refunds."]);
    }
    expect(await sources.zone("nope")).toBeNull();
  });

  it("reads null when there is no analysis", async () => {
    const sources = createPacketSources(contextFor(dir, (name) => join(dir, `.${name}`)), spawned);
    expect(await sources.zone("pay")).toBeNull();
  });
});

describe("prepareReads", () => {
  const ctx = { projectDir: "/p", svDir: "/p/sv", rexDir: "/p/rex", dev: false } as ServerContext;

  it("parses the resolve JSON and returns the dry-run brief from the Prepare seams", async () => {
    const calls: string[] = [];
    const reads = prepareReads(ctx, {
      resolve: async (_c, id, options) => {
        calls.push(`resolve ${id} ${JSON.stringify(options)}`);
        return {
          ok: true,
          resolution: {
            resolved: { model: { value: "opus", source: "task.run.tier" }, maxTurns: { value: 40, source: "default" } },
            saved: { tier: "deep" },
            refusals: [{ code: "dirty-tree", message: "dirty" }],
            warnings: [],
          },
        };
      },
      preview: async (_c, id) => {
        calls.push(`preview ${id}`);
        return { ok: true, brief: "# brief" };
      },
      diagnose: async (_c, runId) => {
        calls.push(`diagnose ${runId}`);
        return {
          ok: true,
          diagnosis: { runId, taskId: "t1", class: "no-changes", summary: "none", evidence: [], actions: [], attempt: { n: 1, of: 2 } },
        };
      },
    });
    expect(await reads.diagnose("r1")).toMatchObject({ class: "no-changes", attempt: { n: 1, of: 2 } });
    expect(await reads.resolve("t1")).toEqual({
      settings: [
        { key: "model", value: "opus", source: "task.run.tier" },
        { key: "maxTurns", value: 40, source: "default" },
      ],
      savedTier: "deep",
      refusals: [{ code: "dirty-tree", message: "dirty" }],
      warnings: [],
    });
    expect(await reads.preview("t1")).toBe("# brief");
    expect(calls).toEqual(["diagnose r1", "resolve t1 {}", "preview t1"]);
  });

  it("answers null when a read fails or throws, so the packet marks the part unavailable", async () => {
    const failing = prepareReads(ctx, {
      resolve: async () => ({ ok: false, failure: "Timed out" }),
      preview: async () => {
        throw new Error("spawn failed");
      },
      diagnose: async () => ({ ok: false, failure: "Timed out" }),
    });
    expect(await failing.diagnose("run-1")).toBeNull();
    expect(await failing.resolve("t1")).toBeNull();
    expect(await failing.preview("t1")).toBeNull();
  });
});

describe("sidecarContextOptions packet", () => {
  const TASK = "c0000000-0000-4000-8000-000000000002";

  it("builds a Describe packet from the spawned reads it is given, not from stubs", async () => {
    cpSync(resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree"), join(dir, ".rex"), { recursive: true });
    const ctx = contextFor(dir, (name) => join(dir, `.${name}`));
    const options = sidecarContextOptions(ctx, {
      resolve: async () => ({ savedTier: "deep", settings: [{ key: "model", value: "opus", source: "task.run.tier" }], refusals: [], warnings: [] }),
      preview: async () => "# Task brief\n",
      diagnose: async () => null,
    });
    const record = { id: "s1", lens: "describe", target: { ref: TASK } } as SidecarSessionRecord;
    const text = await options.packet!(record, new AbortController().signal);
    expect(text).toContain("model = \"opus\" (from task.run.tier)");
    expect(text).toContain("Tier: deep");
    expect(text).toContain("## Brief preview digest");
    expect(text).not.toContain("Not available: the resolve command did not answer");
    expect(text).not.toContain("Not available: the dry run did not answer");
  });
});
