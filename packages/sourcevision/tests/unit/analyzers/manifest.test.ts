import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readManifest,
  writeManifest,
  updateManifestModule,
  updateManifestError,
  recordManifestPacks,
  sortedPackRuns,
  withPackRun,
} from "../../../src/analyzers/manifest.js";

describe("manifest", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("readManifest returns a fresh manifest when no file exists", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    const m = readManifest(tmpDir);

    expect(m.schemaVersion).toBe("1.0.0");
    expect(m.modules).toEqual({});
    expect(m.targetPath).toContain(tmpDir);
  });

  it("writeManifest + readManifest roundtrip", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    const original = readManifest(tmpDir);
    original.modules.inventory = { status: "complete" };

    writeManifest(tmpDir, original);
    const loaded = readManifest(tmpDir);

    expect(loaded.modules.inventory).toEqual({ status: "complete" });
    expect(loaded.schemaVersion).toBe(original.schemaVersion);
  });

  it("updateManifestModule sets running status with startedAt", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    // Need a manifest file first
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestModule(tmpDir, "inventory", "running");
    const m = readManifest(tmpDir);

    expect(m.modules.inventory.status).toBe("running");
    expect(m.modules.inventory.startedAt).toBeDefined();
  });

  it("updateManifestModule sets complete status with completedAt and clears error", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    // First set an error
    updateManifestError(tmpDir, "inventory", "something broke");
    let m = readManifest(tmpDir);
    expect(m.modules.inventory.error).toBe("something broke");

    // Then mark complete — error should be cleared
    updateManifestModule(tmpDir, "inventory", "complete");
    m = readManifest(tmpDir);

    expect(m.modules.inventory.status).toBe("complete");
    expect(m.modules.inventory.completedAt).toBeDefined();
    expect(m.modules.inventory.error).toBeUndefined();
  });

  it("updateManifestError sets error status and message", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    updateManifestError(tmpDir, "imports", "parse failure");
    const m = readManifest(tmpDir);

    expect(m.modules.imports.status).toBe("error");
    expect(m.modules.imports.error).toBe("parse failure");
    expect(m.modules.imports.completedAt).toBeDefined();
  });
});

describe("manifest packs", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("recordManifestPacks writes the packs that ran sorted by id, one entry per id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, readManifest(tmpDir));

    recordManifestPacks(tmpDir, [{ id: "php", version: "1.0.0" }, { id: "go", version: "1.0.0" }, { id: "php", version: "1.0.0" }]);

    expect(readManifest(tmpDir).packs).toEqual([{ id: "go", version: "1.0.0" }, { id: "php", version: "1.0.0" }]);
  });

  it("recordManifestPacks writes an empty list when no pack ran, replacing an earlier list", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-man-"));
    writeManifest(tmpDir, { ...readManifest(tmpDir), packs: [{ id: "php", version: "1.0.0" }] });

    recordManifestPacks(tmpDir, []);

    expect(readManifest(tmpDir).packs).toEqual([]);
  });

  it("sortedPackRuns gives the same order whatever order the packs ran in", () => {
    const a = sortedPackRuns([{ id: "terraform", version: "1" }, { id: "java", version: "1" }]);
    const b = sortedPackRuns([{ id: "java", version: "1" }, { id: "terraform", version: "1" }]);
    expect(a).toEqual(b);
    expect(a.map((p) => p.id)).toEqual(["java", "terraform"]);
  });

  it("withPackRun adds a pack that ran in sort order and removes one that did not", () => {
    const listed = [{ id: "go", version: "1" }, { id: "terraform", version: "1" }];
    expect(withPackRun([{ id: "go", version: "1" }, { id: "php", version: "1" }], "java", "1"))
      .toEqual([{ id: "go", version: "1" }, { id: "java", version: "1" }, { id: "php", version: "1" }]);
    expect(withPackRun(listed, "terraform", undefined)).toEqual([{ id: "go", version: "1" }]);
  });

  it("withPackRun leaves a manifest with no list without one", () => {
    expect(withPackRun(undefined, "terraform", "1")).toBeUndefined();
  });
});
