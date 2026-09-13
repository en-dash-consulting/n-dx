/**
 * Hub registry — ~/.n-dx/hub.json parsing and persistence.
 *
 * The registry outlives the hub process; its whole value is surviving
 * restarts. These tests pin the two properties that make that safe: writes
 * are atomic (no torn registry is ever observable) and reads degrade to an
 * empty registry instead of erroring, entry by entry — one corrupted project
 * record must not discard the rest.
 *
 * @see packages/web/src/hub/registry.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseRegistry,
  loadRegistry,
  saveRegistry,
  emptyRegistry,
  REGISTRY_FILENAME,
  type HubProject,
} from "../../../src/hub/registry.js";

function project(over: Partial<HubProject> = {}): HubProject {
  return {
    id: "alpha",
    name: "Alpha",
    repoRoot: "/repos/alpha",
    worktrees: [],
    ndxBin: "/usr/local/bin/n-dx",
    port: 4123,
    pid: 999999,
    lastSeen: "2026-09-13T00:00:00.000Z",
    ...over,
  };
}

describe("parseRegistry", () => {
  it("round-trips a saved registry", () => {
    const registry = { projects: { alpha: project() } };
    expect(parseRegistry(JSON.stringify(registry))).toEqual(registry);
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["a non-object", '"string"'],
    ["projects missing", "{}"],
    ["projects as array", '{"projects": []}'],
  ])("reads %s as an empty registry", (_name, raw) => {
    expect(parseRegistry(raw)).toEqual(emptyRegistry());
  });

  it("drops an entry missing its identity fields but keeps the rest", () => {
    const registry = {
      projects: {
        alpha: project(),
        broken: { id: "broken", name: "no repoRoot or ndxBin" },
      },
    };
    const parsed = parseRegistry(JSON.stringify(registry));
    expect(Object.keys(parsed.projects)).toEqual(["alpha"]);
  });

  it("defaults optional fields for an entry written by hand", () => {
    const parsed = parseRegistry(
      JSON.stringify({
        projects: { a: { id: "a", repoRoot: "/r", ndxBin: "ndx" } },
      }),
    );
    expect(parsed.projects["a"]).toEqual({
      id: "a",
      name: "a",
      repoRoot: "/r",
      worktrees: [],
      ndxBin: "ndx",
      port: null,
      pid: null,
      lastSeen: null,
    });
  });
});

describe("loadRegistry / saveRegistry", () => {
  let hubDir: string;

  beforeEach(async () => {
    hubDir = await mkdtemp(join(tmpdir(), "ndx-hub-registry-"));
  });

  afterEach(async () => {
    await rm(hubDir, { recursive: true, force: true });
  });

  it("treats a missing file as empty", async () => {
    expect(await loadRegistry(hubDir)).toEqual(emptyRegistry());
  });

  it("persists and reloads a registry, creating the hub dir if needed", async () => {
    const nested = join(hubDir, "does-not-exist-yet");
    const registry = { projects: { alpha: project() } };
    await saveRegistry(nested, registry);
    expect(await loadRegistry(nested)).toEqual(registry);
  });

  it("leaves no temp file behind after a save", async () => {
    await saveRegistry(hubDir, { projects: { alpha: project() } });
    const files = await readdir(hubDir);
    expect(files).toEqual([REGISTRY_FILENAME]);
  });

  it("a save fully replaces the previous contents", async () => {
    await saveRegistry(hubDir, { projects: { alpha: project() } });
    await saveRegistry(hubDir, { projects: { beta: project({ id: "beta" }) } });
    const raw = await readFile(join(hubDir, REGISTRY_FILENAME), "utf-8");
    expect(raw).not.toContain('"alpha"');
    expect((await loadRegistry(hubDir)).projects["beta"]?.id).toBe("beta");
  });

  it("a corrupted file on disk loads as empty rather than throwing", async () => {
    await writeFile(join(hubDir, REGISTRY_FILENAME), "{ torn wri", "utf-8");
    expect(await loadRegistry(hubDir)).toEqual(emptyRegistry());
  });
});
