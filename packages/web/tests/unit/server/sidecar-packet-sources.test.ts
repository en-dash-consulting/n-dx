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
import { buildDescribePacket } from "../../../src/server/sidecar/packet-builders.js";
import { createPacketSources, type SpawnedReads } from "../../../src/server/sidecar/packet-sources.js";
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
