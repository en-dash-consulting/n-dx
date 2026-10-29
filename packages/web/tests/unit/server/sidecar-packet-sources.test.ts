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
    });
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
    expect(calls).toEqual(["resolve t1 {}", "preview t1"]);
  });

  it("answers null when a read fails or throws, so the packet marks the part unavailable", async () => {
    const failing = prepareReads(ctx, {
      resolve: async () => ({ ok: false, failure: "Timed out" }),
      preview: async () => {
        throw new Error("spawn failed");
      },
    });
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
    });
    const record = { id: "s1", lens: "describe", target: { ref: TASK } } as SidecarSessionRecord;
    const text = await options.packet!(record);
    expect(text).toContain("model = \"opus\" (from task.run.tier)");
    expect(text).toContain("Tier: deep");
    expect(text).toContain("## Brief preview digest");
    expect(text).not.toContain("Not available: the resolve command did not answer");
    expect(text).not.toContain("Not available: the dry run did not answer");
  });
});
