/**
 * Tests for Go zone edge resolution.
 *
 * Validates the directory-to-files resolver (`resolveEdgeTarget`) and the
 * updated zone pipeline (`buildCrossings` via `runZonePipeline`). Covers:
 *
 * 1. Resolver in isolation — JS/TS exact match & Go directory prefix match
 * 2. Go-specific crossing detection — `buildCrossings` with directory edges
 * 3. JS/TS regression guard — crossings unchanged by the resolver addition
 */

import { describe, it, expect } from "vitest";
import {
  resolveEdgeTarget,
  runZonePipeline,
} from "../../../src/analyzers/zones.js";
import {
  makeFileEntry,
  makeInventory,
  makeEdge,
  makeImports,
} from "./zones-helpers.js";

// ── resolveEdgeTarget ────────────────────────────────────────────────────────

describe("resolveEdgeTarget", () => {
  // ── JS/TS-style file paths (direct match) ───────────────────────────────

  it("returns exact match for JS/TS-style file path present in the file set", () => {
    const fileSet = new Set([
      "src/index.ts",
      "src/utils/format.ts",
      "src/services/user-service.ts",
    ]);

    expect(resolveEdgeTarget("src/utils/format.ts", fileSet)).toEqual([
      "src/utils/format.ts",
    ]);
  });

  it("returns exact match for a file at project root", () => {
    const fileSet = new Set(["index.ts", "config.json"]);

    expect(resolveEdgeTarget("index.ts", fileSet)).toEqual(["index.ts"]);
  });

  it("returns exact match for deeply nested file", () => {
    const fileSet = new Set([
      "packages/web/src/components/dashboard/Chart.tsx",
    ]);

    expect(
      resolveEdgeTarget(
        "packages/web/src/components/dashboard/Chart.tsx",
        fileSet,
      ),
    ).toEqual(["packages/web/src/components/dashboard/Chart.tsx"]);
  });

  it("returns empty array when JS/TS file path is not in the set", () => {
    const fileSet = new Set(["src/index.ts", "src/app.ts"]);

    expect(resolveEdgeTarget("src/missing.ts", fileSet)).toEqual([]);
  });

  // ── Go-style directory paths (prefix match) ────────────────────────────

  it("returns all files under a Go-style directory path", () => {
    const fileSet = new Set([
      "cmd/api/main.go",
      "cmd/api/router.go",
      "internal/handler/user.go",
      "internal/handler/admin.go",
      "internal/service/user.go",
    ]);

    const result = resolveEdgeTarget("internal/handler", fileSet);
    expect(result).toHaveLength(2);
    expect(result).toContain("internal/handler/user.go");
    expect(result).toContain("internal/handler/admin.go");
  });

  it("returns all files for a single-segment Go directory", () => {
    const fileSet = new Set([
      "cmd/main.go",
      "pkg/util.go",
      "pkg/helpers.go",
    ]);

    const result = resolveEdgeTarget("pkg", fileSet);
    expect(result).toHaveLength(2);
    expect(result).toContain("pkg/util.go");
    expect(result).toContain("pkg/helpers.go");
  });

  it("returns files only from the exact directory, not sibling prefixes", () => {
    const fileSet = new Set([
      "internal/handler/user.go",
      "internal/handler-v2/user.go",
      "internal/handler_test/test.go",
    ]);

    // Must only match "internal/handler/" prefix, not "internal/handler-v2/"
    const result = resolveEdgeTarget("internal/handler", fileSet);
    expect(result).toEqual(["internal/handler/user.go"]);
  });

  it("returns nested files under a Go directory", () => {
    const fileSet = new Set([
      "internal/service/user.go",
      "internal/service/helpers/format.go",
    ]);

    const result = resolveEdgeTarget("internal/service", fileSet);
    expect(result).toHaveLength(2);
    expect(result).toContain("internal/service/user.go");
    expect(result).toContain("internal/service/helpers/format.go");
  });

  it("returns empty array when directory has no matching files", () => {
    const fileSet = new Set(["src/app.ts", "src/index.ts"]);

    expect(resolveEdgeTarget("internal/handler", fileSet)).toEqual([]);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("returns empty array for empty file set", () => {
    expect(resolveEdgeTarget("anything", new Set())).toEqual([]);
  });

  it("prefers direct match over prefix match when both could apply", () => {
    // If "pkg" is both a file AND a directory prefix, direct match wins
    const fileSet = new Set(["pkg", "pkg/util.go"]);

    // Direct match returns ["pkg"], not the prefix-matched files
    expect(resolveEdgeTarget("pkg", fileSet)).toEqual(["pkg"]);
  });

  it("handles target with trailing slash gracefully", () => {
    // A target like "internal/handler/" shouldn't match a file named
    // exactly "internal/handler/" — it has no direct match, so prefix
    // matching uses "internal/handler//" which won't match real paths
    const fileSet = new Set(["internal/handler/user.go"]);

    // "internal/handler/" is not in the set, prefix would be "internal/handler//"
    // which doesn't match. This is expected — callers should strip trailing slashes.
    const result = resolveEdgeTarget("internal/handler/", fileSet);
    expect(result).toEqual([]);
  });
});

// ── buildCrossings via runZonePipeline — Go directory edges ──────────────────

describe("buildCrossings — Go-style directory edges", () => {
  // Create two clearly separated clusters with a Go-style cross-cluster edge.
  // Cluster A: a/ files with strong internal edges (triangle)
  // Cluster B: b/ files with strong internal edges (triangle)
  // Cross-cluster: a/x.go → "b" (directory target)
  //
  // Without the resolver, the directory edge creates a phantom node "b" in the
  // graph that lands in cluster A (connected to a/x.go), so no crossing is
  // detected. With the resolver, "b" resolves to b/*.go files in cluster B.

  it("produces non-zero crossings from Go-style directory edges", () => {
    // Cluster A
    const aFiles = ["a/x.go", "a/y.go", "a/z.go"];
    // Cluster B
    const bFiles = ["b/p.go", "b/q.go", "b/r.go"];
    const allFiles = [...aFiles, ...bFiles];

    // Strong intra-cluster edges (triangles)
    const clusterAEdges = [
      makeEdge("a/x.go", "a/y.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/y.go", "a/z.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/z.go", "a/x.go", ["fn1", "fn2", "fn3"]),
    ];
    const clusterBEdges = [
      makeEdge("b/p.go", "b/q.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/q.go", "b/r.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/r.go", "b/p.go", ["fn1", "fn2", "fn3"]),
    ];

    // Go-style cross-cluster edge: targets directory, not file
    const crossEdge = makeEdge("a/x.go", "b", ["*"]);

    const edges = [...clusterAEdges, ...clusterBEdges, crossEdge];
    const imports = makeImports(edges);

    const result = runZonePipeline({
      edges,
      inventory: makeInventory(allFiles.map((f) => makeFileEntry(f))),
      imports,
      scopeFiles: allFiles,
    });

    // Should produce at least one crossing from the Go directory edge
    expect(
      result.crossings.length,
      "Expected non-zero crossings from Go-style directory edge " +
        `a/x.go → b, but got ${result.crossings.length}. ` +
        "The resolver should map 'b' to b/*.go files in the opposite zone.",
    ).toBeGreaterThan(0);

    // Verify crossing structure
    for (const crossing of result.crossings) {
      expect(crossing.from).toBeTruthy();
      expect(crossing.to).toBeTruthy();
      expect(crossing.fromZone).toBeTruthy();
      expect(crossing.toZone).toBeTruthy();
      expect(crossing.fromZone).not.toBe(crossing.toZone);
    }
  });

  it("resolves directory targets to real file paths in crossings", () => {
    const aFiles = ["a/x.go", "a/y.go", "a/z.go"];
    const bFiles = ["b/p.go", "b/q.go", "b/r.go"];
    const allFiles = [...aFiles, ...bFiles];

    const edges = [
      makeEdge("a/x.go", "a/y.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/y.go", "a/z.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/z.go", "a/x.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/p.go", "b/q.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/q.go", "b/r.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/r.go", "b/p.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/x.go", "b", ["*"]),
    ];

    const result = runZonePipeline({
      edges,
      inventory: makeInventory(allFiles.map((f) => makeFileEntry(f))),
      imports: makeImports(edges),
      scopeFiles: allFiles,
    });

    // Crossing targets should be real file paths, not directory paths
    for (const crossing of result.crossings) {
      expect(
        crossing.to,
        `Crossing target "${crossing.to}" looks like a directory, not a file`,
      ).toMatch(/\.\w+$/); // must have a file extension
    }
  });

  it("produces zone separation from Go directory edges for coupling computation", () => {
    const aFiles = ["a/x.go", "a/y.go", "a/z.go"];
    const bFiles = ["b/p.go", "b/q.go", "b/r.go"];
    const allFiles = [...aFiles, ...bFiles];

    const edges = [
      makeEdge("a/x.go", "a/y.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/y.go", "a/z.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/z.go", "a/x.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/p.go", "b/q.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/q.go", "b/r.go", ["fn1", "fn2", "fn3"]),
      makeEdge("b/r.go", "b/p.go", ["fn1", "fn2", "fn3"]),
      makeEdge("a/x.go", "b", ["*"]),
    ];

    const result = runZonePipeline({
      edges,
      inventory: makeInventory(allFiles.map((f) => makeFileEntry(f))),
      imports: makeImports(edges),
      scopeFiles: allFiles,
    });

    // Should produce at least 2 zones (the two clusters)
    expect(result.zones.length).toBeGreaterThanOrEqual(2);

    // At least one zone should have non-zero coupling (from the cross-cluster edge)
    const hasCoupling = result.zones.some((z) => z.coupling > 0);
    expect(
      hasCoupling,
      "Expected at least one zone with non-zero coupling from the " +
        "Go directory edge, but all zones have coupling === 0.",
    ).toBe(true);
  });
});

// ── JS/TS regression guard ──────────────────────────────────────────────────

describe("buildCrossings — JS/TS regression guard", () => {
  // These tests verify that the resolver change does not alter crossing
  // behavior for JS/TS-style file-to-file import edges.

  it("JS/TS file-to-file crossings are produced identically", () => {
    // Two clusters of TS files with file-level cross-cluster edges
    const clusterA = ["src/api/server.ts", "src/api/routes.ts", "src/api/auth.ts"];
    const clusterB = ["src/db/connection.ts", "src/db/models.ts", "src/db/queries.ts"];
    const allFiles = [...clusterA, ...clusterB];

    const edges = [
      // Cluster A internal (triangle)
      makeEdge("src/api/server.ts", "src/api/routes.ts", ["router", "middleware"]),
      makeEdge("src/api/routes.ts", "src/api/auth.ts", ["authenticate"]),
      makeEdge("src/api/auth.ts", "src/api/server.ts", ["app"]),
      // Cluster B internal (triangle)
      makeEdge("src/db/connection.ts", "src/db/models.ts", ["User", "Post"]),
      makeEdge("src/db/models.ts", "src/db/queries.ts", ["buildQuery"]),
      makeEdge("src/db/queries.ts", "src/db/connection.ts", ["pool"]),
      // Cross-cluster: file-to-file (JS/TS style)
      makeEdge("src/api/routes.ts", "src/db/queries.ts", ["findUser"]),
    ];

    const result = runZonePipeline({
      edges,
      inventory: makeInventory(allFiles.map((f) => makeFileEntry(f))),
      imports: makeImports(edges),
      scopeFiles: allFiles,
    });

    // Should produce crossings from the file-to-file edge
    const crossCluster = result.crossings.filter(
      (c) => c.from === "src/api/routes.ts" && c.to === "src/db/queries.ts",
    );
    expect(
      crossCluster.length,
      "Expected a crossing from src/api/routes.ts → src/db/queries.ts " +
        "but none was found. The resolver should not affect JS/TS file-level edges.",
    ).toBe(1);
  });

  it("JS/TS crossing targets remain exact file paths, not directory expansions", () => {
    const allFiles = [
      "src/api/server.ts",
      "src/api/routes.ts",
      "src/db/connection.ts",
      "src/db/models.ts",
    ];

    const edges = [
      makeEdge("src/api/server.ts", "src/api/routes.ts", ["Router"]),
      makeEdge("src/api/routes.ts", "src/api/server.ts", ["app"]),
      makeEdge("src/db/connection.ts", "src/db/models.ts", ["Model"]),
      makeEdge("src/db/models.ts", "src/db/connection.ts", ["pool"]),
      makeEdge("src/api/server.ts", "src/db/connection.ts", ["getPool"]),
    ];

    const result = runZonePipeline({
      edges,
      inventory: makeInventory(allFiles.map((f) => makeFileEntry(f))),
      imports: makeImports(edges),
      scopeFiles: allFiles,
    });

    // Every crossing target should be an exact file path from the input
    const fileSet = new Set(allFiles);
    for (const crossing of result.crossings) {
      expect(
        fileSet.has(crossing.to),
        `Crossing target "${crossing.to}" is not in the original file set. ` +
          "The resolver may have incorrectly expanded a JS/TS file path.",
      ).toBe(true);
      expect(
        fileSet.has(crossing.from),
        `Crossing source "${crossing.from}" is not in the original file set.`,
      ).toBe(true);
    }
  });

  it("crossing count is deterministic across runs for JS/TS edges", () => {
    const allFiles = [
      "src/api/server.ts",
      "src/api/routes.ts",
      "src/db/connection.ts",
      "src/db/models.ts",
    ];

    const edges = [
      makeEdge("src/api/server.ts", "src/api/routes.ts", ["Router"]),
      makeEdge("src/api/routes.ts", "src/api/server.ts", ["app"]),
      makeEdge("src/db/connection.ts", "src/db/models.ts", ["Model"]),
      makeEdge("src/db/models.ts", "src/db/connection.ts", ["pool"]),
      makeEdge("src/api/server.ts", "src/db/connection.ts", ["getPool"]),
    ];

    const opts = {
      edges,
      inventory: makeInventory(allFiles.map((f) => makeFileEntry(f))),
      imports: makeImports(edges),
      scopeFiles: allFiles,
    };

    const run1 = runZonePipeline(opts);
    const run2 = runZonePipeline(opts);

    expect(run1.crossings.length).toBe(run2.crossings.length);
    expect(run1.crossings.map((c) => `${c.from}→${c.to}`).sort()).toEqual(
      run2.crossings.map((c) => `${c.from}→${c.to}`).sort(),
    );
  });
});
