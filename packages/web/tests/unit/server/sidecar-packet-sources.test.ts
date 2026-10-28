/**
 * `createPacketSources` derives the provenance paths a packet shows from the
 * workspace's resolved layout. The packet tests stub `sourcePaths`, so these
 * pin the production values: project-relative, forward slashes, trailing slash
 * on the runs directory, on both layouts.
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
