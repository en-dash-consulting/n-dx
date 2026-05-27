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
  it("counts references and ignores comment / string mentions", () => {
    const src = `
// uses SchedulerEngine
let s = "SchedulerEngine"
let engine = SchedulerEngine()
let mode: MenuMode = .normal
`;
    const refs = findSymbolReferences(src, new Set(["SchedulerEngine", "MenuMode", "Unused"]));
    expect(refs).toEqual(new Map([["SchedulerEngine", 1], ["MenuMode", 1]]));
  });

  it("returns the occurrence count when a symbol is used repeatedly", () => {
    const src = `
let a = AppEnvironment()
let b = AppEnvironment.shared
let c = AppEnvironment()
`;
    const refs = findSymbolReferences(src, new Set(["AppEnvironment"]));
    expect(refs.get("AppEnvironment")).toBe(3);
  });

  it("returns empty when no symbols match", () => {
    const src = `let x = 1\nclass Foo {}`;
    expect(findSymbolReferences(src, new Set(["Bar"]))).toEqual(new Map());
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

    // AppEnvironment uses Store → edge with weight 1 (single reference).
    expect(result.edges).toContainEqual({
      from: "App/AppEnvironment.swift",
      to: "App/Store.swift",
      type: "static",
      symbols: ["Store"],
      weight: 1,
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

  it("edge weight reflects total references across symbols (capped at 10)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-swift-"));
    // AppEnvironment declares one type. The consumer references it 4 times.
    writeFileSync(
      join(dir, "AppEnvironment.swift"),
      `class AppEnvironment {}\n`,
    );
    writeFileSync(
      join(dir, "Consumer.swift"),
      `
let a = AppEnvironment()
let b = AppEnvironment.shared
func make() -> AppEnvironment { AppEnvironment() }
`,
    );

    const result = await buildSwiftImportGraph(
      [{ path: "AppEnvironment.swift" }, { path: "Consumer.swift" }],
      dir,
    );

    const edge = result.edges.find(
      (e) => e.from === "Consumer.swift" && e.to === "AppEnvironment.swift",
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBe(4);
  });

  it("caps edge weight to prevent a single hot edge from dominating zoning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-swift-"));
    writeFileSync(
      join(dir, "AppEnvironment.swift"),
      `class AppEnvironment {}\n`,
    );
    // 30 references — should be capped at 10.
    const consumerBody = Array.from({ length: 30 }, (_, i) => `let x${i} = AppEnvironment()`).join("\n");
    writeFileSync(join(dir, "Consumer.swift"), consumerBody + "\n");

    const result = await buildSwiftImportGraph(
      [{ path: "AppEnvironment.swift" }, { path: "Consumer.swift" }],
      dir,
    );

    const edge = result.edges.find(
      (e) => e.from === "Consumer.swift" && e.to === "AppEnvironment.swift",
    );
    expect(edge!.weight).toBe(10);
  });
});
