/**
 * Symbol evidence: what a zone's own code calls itself, and how it reaches the
 * judgments.
 *
 * The second half of this file is the one that matters for the contract:
 * `buildZoneEvidence` must *add* to the state when imports or a project
 * directory are available and leave it exactly as it was when neither is, so a
 * run without them keys the judgment cache the way it always did.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Imports, Zone } from "../../../src/schema/index.js";
import {
  collectZoneSymbols,
  dominantSymbolNoun,
  extractTopLevelDeclarations,
  isEmptyZoneSymbols,
  isTestPath,
  symbolWords,
} from "../../../src/analyzers/zone-symbols.js";
import { buildZoneEvidence } from "../../../src/analyzers/enrich-judge.js";

function zone(id: string, files: string[], extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "", files, entryPoints: [], cohesion: 0.5, coupling: 0.5, ...extra };
}

const STANDUP_SOURCE = `/**
 * Standup scheduling.
 */
export interface StandupOptions { at: string }
export class StandupService {
  run() { return 1; }
}
export const useStandup = () => 2;
export type StandupId = string;
function privateHelper() { return 3; }
`;

let projectDir: string;
beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sv-symbols-"));
  mkdirSync(join(projectDir, "src/standup"), { recursive: true });
  writeFileSync(join(projectDir, "src/standup/service.ts"), STANDUP_SOURCE);
});
afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

const standupZone = zone("standup", [
  "src/standup/service.ts",
  "tests/standup/service.test.ts",
]);

const imports: Imports = {
  edges: [
    { from: "src/app.ts", to: "src/standup/service.ts", type: "static", symbols: ["StandupService", "useStandup"] },
    { from: "src/cli.ts", to: "src/standup/service.ts", type: "static", symbols: ["StandupService"] },
    { from: "src/barrel.ts", to: "src/standup/service.ts", type: "reexport", symbols: ["StandupOptions", "default"] },
    { from: "src/app.ts", to: "src/other.ts", type: "static", symbols: ["Unrelated"] },
  ],
  external: [],
  summary: { totalEdges: 4, totalExternal: 0, circularCount: 0, circulars: [], mostImported: [], avgImportsPerFile: 1 },
};

describe("isTestPath", () => {
  it("recognises the conventions of each language the analyser reads", () => {
    for (const p of [
      "tests/standup/service.test.ts",
      "packages/web/tests/unit/a.test.ts",
      "src/__tests__/a.ts",
      "internal/server_test.go",
      "app/test_views.py",
      "Sources/AppTests.swift",
    ]) {
      expect(isTestPath(p), p).toBe(true);
    }
    for (const p of ["src/standup/service.ts", "src/contest.ts", "src/latest.ts"]) {
      expect(isTestPath(p), p).toBe(false);
    }
  });
});

describe("extractTopLevelDeclarations", () => {
  it("returns exported top-level declarations only, with their kind and line", () => {
    const decls = extractTopLevelDeclarations(STANDUP_SOURCE, "src/standup/service.ts");
    expect(decls.map((d) => `${d.kind} ${d.name}`)).toEqual([
      "interface StandupOptions",
      "class StandupService",
      "function useStandup",
      "type StandupId",
    ]);
    // The unexported helper is absent, and lines point at the declaration.
    expect(decls.map((d) => d.name)).not.toContain("privateHelper");
    expect(decls[1].line).toBe(5);
  });

  it("falls back to a keyword scan for languages the TS parser cannot read", () => {
    const go = "package main\n\nfunc ServeHTTP() {}\nfunc helper() {}\n";
    expect(extractTopLevelDeclarations(go, "main.go").map((d) => d.name)).toEqual(["ServeHTTP", "helper"]);
  });
});

describe("collectZoneSymbols", () => {
  it("counts exported symbols from inbound edges, most common first", () => {
    const s = collectZoneSymbols(standupZone, { imports });
    expect(s.exportedSymbols).toEqual(["StandupService", "StandupOptions", "useStandup"]);
    // `default` names no declaration, and a symbol on an edge into another
    // zone is not this zone's.
    expect(s.exportedSymbols).not.toContain("default");
    expect(s.exportedSymbols).not.toContain("Unrelated");
  });

  it("reads declarations from the sampled source files, skipping tests", () => {
    const s = collectZoneSymbols(standupZone, { projectDir });
    expect(s.declarations.map((d) => d.name)).toEqual([
      "StandupOptions",
      "StandupService",
      "useStandup",
      "StandupId",
    ]);
  });

  it("lists test file names by basename", () => {
    expect(collectZoneSymbols(standupZone, {}).testFiles).toEqual(["service.test.ts"]);
  });

  it("is empty, not partial, with neither imports nor a project directory", () => {
    const bare = zone("bare", ["src/a.ts"]);
    expect(isEmptyZoneSymbols(collectZoneSymbols(bare, {}))).toBe(true);
  });
});

describe("dominantSymbolNoun", () => {
  it("finds the subject the exported symbols share, ignoring role words", () => {
    expect(symbolWords("useStandup")).toEqual(["use", "standup"]);
    expect(dominantSymbolNoun(["StandupService", "StandupRepo", "useStandup"])).toEqual({ word: "standup", count: 3 });
  });

  it("returns nothing when the symbols share no subject", () => {
    expect(dominantSymbolNoun(["parseJson", "renderTable", "writeFile", "sortRows", "hashKey"])).toBeUndefined();
    expect(dominantSymbolNoun(["Alone"])).toBeUndefined();
  });

  it("will not name a zone after a role word alone", () => {
    expect(dominantSymbolNoun(["UserService", "OrderService", "CartService"])).toBeUndefined();
  });
});

describe("buildZoneEvidence", () => {
  it("adds exported symbols, declarations and test file names when the data is available", () => {
    const state = buildZoneEvidence(["standup"], { zones: [standupZone], imports, projectDir });
    const entry = state["standup"] as Record<string, unknown>;
    expect(entry.exportedSymbols).toEqual(["StandupService", "StandupOptions", "useStandup"]);
    expect(entry.declarations).toEqual([
      "interface StandupOptions",
      "class StandupService",
      "function useStandup",
      "type StandupId",
    ]);
    expect(entry.testFiles).toEqual(["service.test.ts"]);
  });

  it("carries the symbol block on imports alone, with no project directory", () => {
    const entry = buildZoneEvidence(["standup"], { zones: [standupZone], imports })["standup"] as Record<string, unknown>;
    expect(entry.exportedSymbols).toEqual(["StandupService", "StandupOptions", "useStandup"]);
    expect(entry.declarations).toEqual([]);
  });

  it("is unchanged when neither imports nor a project directory are available", () => {
    const bare = zone("bare", ["src/a.ts", "src/b.ts"]);
    const entry = buildZoneEvidence(["bare"], { zones: [bare] })["bare"] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(["fileCount", "files", "headers", "importsTo"]);
  });
});
