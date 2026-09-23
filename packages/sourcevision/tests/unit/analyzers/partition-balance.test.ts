import { describe, it, expect } from "vitest";
import { splitByFirstDifferingDirectory } from "../../../src/analyzers/louvain.js";
import {
  deriveTestSuiteCommunity,
  foldSmallTestCommunities,
  isBalancedSubdivision,
  LOPSIDED_CHILD_SHARE,
  subdivideZone,
  analyzeZones,
} from "../../../src/analyzers/zones.js";
import type { Zone } from "../../../src/schema/index.js";
import { makeEdge, makeFileEntry, makeImports, makeInventory, makeZone } from "./zones-helpers.js";

function everyChildBalanced(zone: Zone): boolean {
  if (!zone.subZones?.length) return true;
  return isBalancedSubdivision(zone.subZones, zone.files.length) && zone.subZones.every(everyChildBalanced);
}

describe("splitByFirstDifferingDirectory", () => {
  it("keys files by the first directory below their common prefix and folds small groups", () => {
    const files = [
      ...[1, 2, 3, 4].map((i) => `app/utils/a/f${i}.ts`),
      ...[1, 2, 3, 4].map((i) => `app/utils/b/f${i}.ts`),
      "app/utils/c/lonely.ts",
    ];
    const split = splitByFirstDifferingDirectory(files, 3)!;
    expect(new Set(split.values()).size).toBe(2);
    expect(split.get("app/utils/c/lonely.ts")).toBe(split.get("app/utils/a/f1.ts"));
  });

  it("returns null when fewer than two groups are large enough", () => {
    expect(splitByFirstDifferingDirectory(["a/x/1.ts", "a/x/2.ts", "a/x/3.ts", "a/y/1.ts"], 3)).toBeNull();
  });
});

describe("subdivideZone", () => {
  it("splits a 60-file zone of three sparsely linked directories into three balanced children", () => {
    const dirs = ["alpha", "beta", "gamma"];
    const files = dirs.flatMap((d) => Array.from({ length: 20 }, (_, i) => `src/core/${d}/m${i}.ts`));
    const edges = dirs.flatMap((d) => [
      makeEdge(`src/core/${d}/m0.ts`, `src/core/${d}/m1.ts`),
      makeEdge(`src/core/${d}/m1.ts`, `src/core/${d}/m2.ts`),
    ]);
    edges.push(makeEdge("src/core/alpha/m3.ts", "src/core/beta/m3.ts"));
    const inventory = makeInventory(files.map((p) => makeFileEntry(p)));
    const zone = makeZone("core", files);
    const children = subdivideZone(zone, makeImports(edges), inventory);
    expect(children.length).toBeGreaterThanOrEqual(3);
    expect(isBalancedSubdivision(children, files.length)).toBe(true);
  });

  it("gives a zone with one dominant cluster no sub-zones rather than a sliver chain", () => {
    // 45 files in one directory that all import each other (no internal
    // structure to split on), plus three 3-file slivers.
    const blob = Array.from({ length: 45 }, (_, i) => `app/utils/u${i}.ts`);
    const slivers = ["a", "b", "c"].flatMap((d) => [1, 2, 3].map((i) => `app/${d}/s${i}.ts`));
    const files = [...blob, ...slivers];
    const edges = [
      ...blob.flatMap((f, i) => blob.slice(i + 1).map((g) => makeEdge(f, g))),
      ...["a", "b", "c"].flatMap((d) => [makeEdge(`app/${d}/s1.ts`, `app/${d}/s2.ts`), makeEdge(`app/${d}/s2.ts`, `app/${d}/s3.ts`), makeEdge(`app/${d}/s1.ts`, "app/utils/u0.ts")]),
    ];
    const inventory = makeInventory(files.map((p) => makeFileEntry(p)));
    const zone = makeZone("utils", files);
    const children = subdivideZone(zone, makeImports(edges), inventory);
    expect(children).toEqual([]);
  });

  it("never nests a child holding the lopsided share of its parent, at any depth", async () => {
    const blob = Array.from({ length: 80 }, (_, i) => `app/utils/u${i}.ts`);
    const features = ["x", "y"].flatMap((d) => Array.from({ length: 10 }, (_, i) => `app/${d}/f${i}.ts`));
    const files = [...blob, ...features];
    const edges = [
      ...blob.flatMap((f, i) => [makeEdge(f, blob[(i + 1) % blob.length]), makeEdge(f, blob[(i + 11) % blob.length])]),
      ...features.map((f, i) => makeEdge(f, features[(i + 1) % features.length])),
      ...features.map((f, i) => makeEdge(f, blob[i])),
    ];
    const { zones } = await analyzeZones(makeInventory(files.map((p) => makeFileEntry(p))), makeImports(edges), { enrich: false, maxZonePercent: 100 });
    for (const z of zones.zones) expect(everyChildBalanced(z), z.id).toBe(true);
    expect(LOPSIDED_CHILD_SHARE).toBe(0.7);
  });
});

describe("test grouping", () => {
  it("groups nested __tests__ directories by their parent and keeps suites of nested test roots", () => {
    expect(deriveTestSuiteCommunity("app/utils/__tests__/a.test.ts")).toBe("tests:app/utils");
    expect(deriveTestSuiteCommunity("app/routes/__tests__/b.test.ts")).toBe("tests:app/routes");
    expect(deriveTestSuiteCommunity("packages/web/tests/unit/x/c.test.ts")).toBe("tests:packages/web#unit");
    expect(deriveTestSuiteCommunity("tests/e2e/d.test.js")).toBe("tests:tests#e2e");
    expect(deriveTestSuiteCommunity("Tests/CoreTests/e.swift")).toBe("tests:Tests#CoreTests");
  });

  it("folds groups below the minimum into their nearest ancestor", () => {
    const m = new Map([
      ["app/a/__tests__/1.test.ts", "tests:app/a"],
      ["app/b/__tests__/1.test.ts", "tests:app/b"],
      ["app/c/__tests__/1.test.ts", "tests:app/c"],
      ["app/d/__tests__/1.test.ts", "tests:app/d"],
      ["app/d/__tests__/2.test.ts", "tests:app/d"],
      ["app/d/__tests__/3.test.ts", "tests:app/d"],
    ]);
    foldSmallTestCommunities(m, 3);
    expect(m.get("app/a/__tests__/1.test.ts")).toBe("tests:app");
    expect(m.get("app/d/__tests__/1.test.ts")).toBe("tests:app/d");
  });

  it("puts tests of different parents into different zones, with distinct ids", async () => {
    const files = [
      ...[1, 2, 3].map((i) => `app/utils/__tests__/u${i}.test.ts`),
      ...[1, 2, 3].map((i) => `app/routes/apps/digest/utils/__tests__/d${i}.test.ts`),
      ...[1, 2, 3].map((i) => `app/utils/u${i}.ts`),
      ...[1, 2, 3].map((i) => `app/routes/apps/digest/utils/d${i}.ts`),
    ];
    const inventory = makeInventory(files.map((p) => makeFileEntry(p, p.includes("__tests__") ? { role: "test" } : {})));
    const imports = makeImports([
      ...[1, 2, 3].map((i) => makeEdge(`app/utils/__tests__/u${i}.test.ts`, `app/utils/u${i}.ts`)),
      ...[1, 2, 3].map((i) => makeEdge(`app/routes/apps/digest/utils/__tests__/d${i}.test.ts`, `app/routes/apps/digest/utils/d${i}.ts`)),
      makeEdge("app/utils/u1.ts", "app/utils/u2.ts"), makeEdge("app/utils/u2.ts", "app/utils/u3.ts"),
      makeEdge("app/routes/apps/digest/utils/d1.ts", "app/routes/apps/digest/utils/d2.ts"),
      makeEdge("app/routes/apps/digest/utils/d2.ts", "app/routes/apps/digest/utils/d3.ts"),
    ]);
    const { zones } = await analyzeZones(inventory, imports, { enrich: false });
    const a = zones.zones.find((z) => z.files.includes("app/utils/__tests__/u1.test.ts"))!;
    const b = zones.zones.find((z) => z.files.includes("app/routes/apps/digest/utils/__tests__/d1.test.ts"))!;
    expect(a.id).not.toBe(b.id);
    expect(a.files.every((f) => f.startsWith("app/utils/__tests__/"))).toBe(true);
    expect(b.files.every((f) => f.startsWith("app/routes/apps/digest/utils/__tests__/"))).toBe(true);
  });
});
