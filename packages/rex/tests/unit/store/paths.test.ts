import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PRD_TREE_DIRNAME,
  TREE_META_FILENAME,
  resolveRexPaths,
} from "../../../src/store/paths.js";
import * as storeBarrel from "../../../src/store/index.js";

let legacyRoot: string;
let ndxRoot: string;

beforeAll(() => {
  legacyRoot = mkdtempSync(join(tmpdir(), "rex-paths-legacy-"));
  mkdirSync(join(legacyRoot, ".rex", PRD_TREE_DIRNAME), { recursive: true });

  ndxRoot = mkdtempSync(join(tmpdir(), "rex-paths-ndx-"));
  mkdirSync(join(ndxRoot, ".ndx", "rex", PRD_TREE_DIRNAME), { recursive: true });
});

afterAll(() => {
  for (const dir of [legacyRoot, ndxRoot]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveRexPaths", () => {
  it("resolves under .ndx/ when the container is present", () => {
    const paths = resolveRexPaths(ndxRoot);
    const rexDir = join(ndxRoot, ".ndx", "rex");

    expect(paths.rexDir).toBe(rexDir);
    expect(paths.prdTreeDir).toBe(join(rexDir, PRD_TREE_DIRNAME));
    expect(paths.treeMetaPath).toBe(join(rexDir, TREE_META_FILENAME));
    expect(paths.prdLockPath).toBe(join(rexDir, "prd.lock"));
  });

  it("falls back to .rex/ when the container is absent", () => {
    const paths = resolveRexPaths(legacyRoot);
    const rexDir = join(legacyRoot, ".rex");

    expect(paths.rexDir).toBe(rexDir);
    expect(paths.prdTreeDir).toBe(join(rexDir, PRD_TREE_DIRNAME));
    expect(paths.treeMetaPath).toBe(join(rexDir, TREE_META_FILENAME));
  });

  it("honours an explicit mode, for init and migrate-layout", () => {
    // Both commands need the target paths before the container exists.
    expect(resolveRexPaths(legacyRoot, { mode: "ndx" }).rexDir).toBe(
      join(legacyRoot, ".ndx", "rex"),
    );
  });

  it("composes the tree path from the constant rather than a second literal", () => {
    // The point of the module: renaming the folder tree stays a one-line
    // change here, and moving `.rex/` itself stays a decision in the resolver.
    expect(resolveRexPaths(legacyRoot).prdTreeDir).toContain(PRD_TREE_DIRNAME);
  });

  it("is reachable through the store barrel, like the constants beside it", () => {
    // `store/index.ts` is how everything outside `src/store/` reaches this
    // module — the call sites the routing task rewires included. A resolver
    // that only the barrel's siblings can see would send those sites back to
    // joining `.rex` themselves, which is the habit being retired.
    expect(storeBarrel.resolveRexPaths).toBe(resolveRexPaths);
  });
});
