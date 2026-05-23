import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractSwiftImportModules,
  extractSwiftDeclarations,
  findSymbolReferences,
  buildSwiftImportGraph,
} from "../../../src/analyzers/swift-imports.js";

// ── extractSwiftImportModules ────────────────────────────────────────────────

describe("extractSwiftImportModules", () => {
  it("captures common Apple frameworks", () => {
    const src = `
import Foundation
import SwiftUI
import AppKit
import Combine
`;
    const mods = extractSwiftImportModules(src);
    expect(mods).toEqual(["Foundation", "SwiftUI", "AppKit", "Combine"]);
  });

  it("captures submodule imports (import X.Y)", () => {
    const src = `import SwiftUI.Color\n`;
    expect(extractSwiftImportModules(src)).toEqual(["SwiftUI"]);
  });

  it("captures import access modifiers (import class, import struct)", () => {
    const src = `
import class Foundation.NSObject
import struct Foundation.URL
`;
    expect(extractSwiftImportModules(src)).toEqual(["Foundation", "Foundation"]);
  });

  it("ignores imports inside comments and strings", () => {
    const src = `
// import HiddenInComment
import SwiftUI
let s = "import HiddenInString"
`;
    expect(extractSwiftImportModules(src)).toEqual(["SwiftUI"]);
  });
});

// ── extractSwiftDeclarations ─────────────────────────────────────────────────

describe("extractSwiftDeclarations", () => {
  it("captures class/struct/enum/protocol/actor/extension/typealias", () => {
    const src = `
class SchedulerEngine {}
struct AppEnvironment {}
enum MenuMode {}
protocol OverlayPresenting {}
actor Store {}
extension AppEnvironment {}
typealias Handler = () -> Void
`;
    const decls = extractSwiftDeclarations(src);
    expect(new Set(decls)).toEqual(
      new Set(["SchedulerEngine", "AppEnvironment", "MenuMode", "OverlayPresenting", "Store", "Handler"]),
    );
  });

  it("ignores declarations inside string literals and comments", () => {
    const src = `
// class HiddenInComment {}
let note = "class HiddenInString"
struct Real {}
`;
    expect(extractSwiftDeclarations(src)).toEqual(["Real"]);
  });
});

// ── findSymbolReferences ─────────────────────────────────────────────────────

describe("findSymbolReferences", () => {
  it("finds references and ignores comment / string mentions", () => {
    const src = `
// uses SchedulerEngine
let s = "SchedulerEngine"
let engine = SchedulerEngine()
let mode: MenuMode = .normal
`;
    const refs = findSymbolReferences(src, new Set(["SchedulerEngine", "MenuMode", "Unused"]));
    expect(refs).toEqual(new Set(["SchedulerEngine", "MenuMode"]));
  });

  it("returns empty when no symbols match", () => {
    const src = `let x = 1\nclass Foo {}`;
    expect(findSymbolReferences(src, new Set(["Bar"]))).toEqual(new Set());
  });
});

// ── buildSwiftImportGraph ────────────────────────────────────────────────────

describe("buildSwiftImportGraph", () => {
  it("builds file→file edges from symbol references and skips self-loops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-swift-"));
    mkdirSync(join(dir, "App"));
    writeFileSync(
      join(dir, "App", "AppEnvironment.swift"),
      `import Foundation\nclass AppEnvironment {\n  let store = Store()\n}\n`,
    );
    writeFileSync(
      join(dir, "App", "Store.swift"),
      `import Foundation\nactor Store {}\n`,
    );
    writeFileSync(
      join(dir, "App", "MenuContent.swift"),
      `import SwiftUI\nstruct MenuContent {\n  let env: AppEnvironment\n  let store: Store\n}\n`,
    );

    const result = await buildSwiftImportGraph(
      [
        { path: "App/AppEnvironment.swift" },
        { path: "App/Store.swift" },
        { path: "App/MenuContent.swift" },
      ],
      dir,
    );

    // AppEnvironment uses Store → edge.
    expect(result.edges).toContainEqual({
      from: "App/AppEnvironment.swift",
      to: "App/Store.swift",
      type: "static",
      symbols: ["Store"],
    });

    // MenuContent uses AppEnvironment AND Store → two edges.
    const fromMenu = result.edges.filter((e) => e.from === "App/MenuContent.swift");
    const toSet = new Set(fromMenu.map((e) => e.to));
    expect(toSet).toEqual(new Set(["App/AppEnvironment.swift", "App/Store.swift"]));

    // Store does not reference anything → no outgoing edges.
    expect(result.edges.filter((e) => e.from === "App/Store.swift")).toEqual([]);

    // External imports captured and classified.
    const pkgs = new Set(result.external.map((e) => e.package));
    expect(pkgs).toEqual(new Set(["stdlib:Foundation", "stdlib:SwiftUI"]));
  });

  it("handles missing files gracefully without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-swift-"));
    const result = await buildSwiftImportGraph(
      [{ path: "Missing.swift" }],
      dir,
    );
    expect(result.edges).toEqual([]);
    expect(result.external).toEqual([]);
  });
});
