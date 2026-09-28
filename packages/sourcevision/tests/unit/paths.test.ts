import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSourcevisionPaths, SV_CACHE_DIRNAME } from "../../src/paths.js";
import { DATA_FILES } from "../../src/schema/data-files.js";

let legacyRoot: string;
let ndxRoot: string;

beforeAll(() => {
  legacyRoot = mkdtempSync(join(tmpdir(), "sv-paths-legacy-"));
  mkdirSync(join(legacyRoot, ".sourcevision"), { recursive: true });

  ndxRoot = mkdtempSync(join(tmpdir(), "sv-paths-ndx-"));
  mkdirSync(join(ndxRoot, ".ndx", "sourcevision"), { recursive: true });
});

afterAll(() => {
  for (const dir of [legacyRoot, ndxRoot]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveSourcevisionPaths", () => {
  it("resolves under .ndx/ when the container is present", () => {
    const paths = resolveSourcevisionPaths(ndxRoot);
    const svDir = join(ndxRoot, ".ndx", "sourcevision");

    expect(paths.svDir).toBe(svDir);
    expect(paths.manifestPath).toBe(join(svDir, DATA_FILES.manifest));
    expect(paths.cacheDir).toBe(join(svDir, SV_CACHE_DIRNAME));
  });

  it("falls back to .sourcevision/ when the container is absent", () => {
    const paths = resolveSourcevisionPaths(legacyRoot);
    const svDir = join(legacyRoot, ".sourcevision");

    expect(paths.svDir).toBe(svDir);
    expect(paths.manifestPath).toBe(join(svDir, DATA_FILES.manifest));
    expect(paths.cacheDir).toBe(join(svDir, SV_CACHE_DIRNAME));
  });

  it("honours an explicit mode, for init and migrate-layout", () => {
    expect(resolveSourcevisionPaths(legacyRoot, { mode: "ndx" }).svDir).toBe(
      join(legacyRoot, ".ndx", "sourcevision"),
    );
  });

  it("resolves every artifact from the DATA_FILES table, not a second copy", () => {
    const { dataFile, svDir } = resolveSourcevisionPaths(legacyRoot);

    for (const key of Object.keys(DATA_FILES) as (keyof typeof DATA_FILES)[]) {
      expect(dataFile(key)).toBe(join(svDir, DATA_FILES[key]));
    }
  });
});
