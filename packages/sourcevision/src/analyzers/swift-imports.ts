/**
 * Swift import + symbol-reference resolver.
 *
 * Swift's `import X` references a MODULE (Foundation, SwiftUI, AppKit, a SPM
 * dependency), not a file — files in the same module reference each other
 * implicitly with no import statement. A literal "Swift import parser" would
 * therefore produce zero internal edges and leave zone detection guessing
 * from file-tree proximity.
 *
 * This analyzer is two passes:
 *   1. Top-of-file `import X` → external imports. Used for framework
 *      detection (SwiftUI vs AppKit vs UIKit) and stdlib classification.
 *   2. Symbol declarations (`class/struct/enum/protocol/actor/extension`)
 *      across the project build a symbol → file index. Each file is then
 *      scanned for references to those declared symbols and yields one
 *      internal edge per referenced symbol's declaring file.
 *
 * This gives sourcevision a real, if heuristic, Swift file→file import
 * graph — `importGraphQuality` flips from "absent" to "rich" on a typical
 * SwiftUI app and zone detection (Louvain) produces meaningful zones with
 * actual cohesion rather than proximity-driven noise.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImportEdge, ImportType, ExternalImport } from "../schema/index.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface SwiftImportResult {
  /** Internal edges built from symbol references (file → file). */
  edges: ImportEdge[];
  /** External module imports (`import X` statements). */
  external: ExternalImport[];
}

// ── Apple stdlib / first-party framework list ────────────────────────────────
//
// Anything outside this set imported via `import X` is treated as third-party.
// Not exhaustive — covers what a typical macOS/iOS app uses. Easy to extend.

const APPLE_STDLIB_MODULES: ReadonlySet<string> = new Set([
  // Core
  "Foundation", "Swift", "ObjectiveC", "Dispatch", "OSLog", "os",
  // UI
  "SwiftUI", "AppKit", "UIKit", "WatchKit", "TVUIKit",
  // System frameworks
  "Combine", "CoreData", "CoreGraphics", "CoreText", "CoreImage", "CoreLocation",
  "CoreMedia", "CoreAudio", "CoreBluetooth", "CoreMotion", "CoreML", "CoreTelephony",
  "Accelerate", "Accessibility", "AVFoundation", "AVKit",
  "Network", "NetworkExtension", "AppIntents", "Intents", "IntentsUI",
  "MediaPlayer", "MetricKit", "WebKit",
  "MapKit", "Charts", "Photos", "PhotosUI", "Vision", "VisionKit",
  "QuickLook", "QuickLookUI", "QuickLookThumbnailing",
  "Security", "LocalAuthentication", "AuthenticationServices",
  "CryptoKit", "DeviceCheck", "AdSupport", "ARKit", "SceneKit", "SpriteKit",
  "RealityKit", "ModelIO", "GameKit", "GameplayKit",
  "Speech", "NaturalLanguage", "SoundAnalysis",
  "UserNotifications", "UserNotificationsUI",
  "StoreKit", "CloudKit", "PassKit", "Contacts", "ContactsUI",
  "EventKit", "EventKitUI", "HomeKit", "HealthKit", "BackgroundTasks",
  "WidgetKit", "ActivityKit",
  // Testing
  "XCTest", "Testing",
  // Catalyst / Multi-platform
  "TabularData",
]);

function classifyImport(modulePath: string): "stdlib" | "third-party" {
  return APPLE_STDLIB_MODULES.has(modulePath) ? "stdlib" : "third-party";
}

// ── Comment + string stripping ───────────────────────────────────────────────
//
// We strip line and block comments and double-quoted strings before scanning
// for declarations and references. Without this, every `// uses SchedulerEngine`
// comment would be parsed as a real reference. Multi-line `"""` strings are
// also stripped. We keep it simple — no full lexer — but it handles the cases
// that drive false positives in practice.

function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i];
    const next = src[i + 1];
    // Line comment
    if (c === "/" && next === "/") {
      const eol = src.indexOf("\n", i);
      out += src.slice(i, i + 2); // keep "//" so line lengths roughly match for line-based scanners
      i = eol === -1 ? len : eol;
      continue;
    }
    // Block comment
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    // Multi-line string `"""..."""`
    if (c === '"' && next === '"' && src[i + 2] === '"') {
      const end = src.indexOf('"""', i + 3);
      i = end === -1 ? len : end + 3;
      continue;
    }
    // Single-line string `"..."` with escape handling
    if (c === '"') {
      i++;
      while (i < len) {
        const ch = src[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === '"' || ch === "\n") { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ── Import-line extraction ───────────────────────────────────────────────────

const IMPORT_RE = /^\s*import\s+(?:[a-z]+\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_.]*)?\s*$/;

/** Extract `import X` modules from a Swift source. Returns module names. */
export function extractSwiftImportModules(src: string): string[] {
  const cleaned = stripCommentsAndStrings(src);
  const out: string[] = [];
  for (const line of cleaned.split("\n")) {
    const m = IMPORT_RE.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

// ── Declaration extraction ───────────────────────────────────────────────────
//
// Swift declarations that introduce a referenceable type name. `extension`
// is included so that `extension Foo { … }` produces a reference back to the
// file that originally declared Foo (handled at edge-build time).

const DECL_RE = /\b(?:class|struct|enum|protocol|actor|extension|typealias)\s+([A-Z][A-Za-z0-9_]*)/g;

/** Extract declared top-level symbol names from a Swift source. */
export function extractSwiftDeclarations(src: string): string[] {
  const cleaned = stripCommentsAndStrings(src);
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(cleaned)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

// ── Reference extraction ─────────────────────────────────────────────────────
//
// We don't try to parse Swift expressions. Instead: after stripping comments
// and strings, every word-boundary occurrence of a known declared symbol that
// is NOT the declaration itself counts as a reference. Skipping the file's
// own declarations avoids self-loops.

/**
 * Find which of `symbols` are referenced in `src`. Caller is expected to
 * pre-strip the file's own declarations so a file that declares Foo and uses
 * it elsewhere doesn't self-loop.
 */
export function findSymbolReferences(src: string, symbols: ReadonlySet<string>): Set<string> {
  const cleaned = stripCommentsAndStrings(src);
  const hits = new Set<string>();
  if (symbols.size === 0) return hits;
  // Tokenize identifiers and lookup. Tokenizer is cheap and avoids the
  // RegExp-per-symbol pathology.
  const tokenRe = /[A-Z][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    if (symbols.has(m[0])) hits.add(m[0]);
  }
  return hits;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Build the full Swift import graph for a set of Swift files. Two-pass:
 * collect declarations first, then walk files and emit edges.
 *
 * `targetDir` is the absolute project root used to resolve relative
 * `filePath`s to disk reads.
 */
export async function buildSwiftImportGraph(
  swiftFiles: Array<{ path: string }>,
  targetDir: string,
): Promise<SwiftImportResult> {
  // Pre-read all source contents once; both passes need them.
  const sources = new Map<string, string>();
  for (const f of swiftFiles) {
    try {
      const text = await readFile(join(targetDir, f.path), "utf-8");
      sources.set(f.path, text);
    } catch {
      // Skip unreadable files — they just won't contribute.
    }
  }

  // Pass 1: collect declarations and external imports.
  /** symbol → declaring file paths (multiple if name collides across files). */
  const declIndex = new Map<string, string[]>();
  /** declared symbols PER file (used to exclude self-references in pass 2). */
  const ownDecls = new Map<string, Set<string>>();
  const externalMap = new Map<string, ExternalImport>();

  for (const [path, src] of sources) {
    const decls = extractSwiftDeclarations(src);
    ownDecls.set(path, new Set(decls));
    for (const sym of decls) {
      const arr = declIndex.get(sym) ?? [];
      arr.push(path);
      declIndex.set(sym, arr);
    }
    for (const mod of extractSwiftImportModules(src)) {
      const kind = classifyImport(mod);
      const pkg = kind === "stdlib" ? `stdlib:${mod}` : mod;
      const existing = externalMap.get(pkg);
      if (existing) {
        if (!existing.importedBy.includes(path)) existing.importedBy.push(path);
      } else {
        externalMap.set(pkg, { package: pkg, importedBy: [path], symbols: ["*"] });
      }
    }
  }

  // Pass 2: walk each file, find references to declared symbols, emit edges.
  const edgeMap = new Map<string, ImportEdge>();
  const allSymbols = new Set(declIndex.keys());

  for (const [path, src] of sources) {
    const own = ownDecls.get(path) ?? new Set<string>();
    // Subtract this file's own declarations from the lookup set so a file's
    // internal use of a symbol it owns isn't counted as an external edge.
    const candidates = own.size === 0
      ? allSymbols
      : new Set([...allSymbols].filter((s) => !own.has(s)));

    const refs = findSymbolReferences(src, candidates);
    for (const sym of refs) {
      const declaringFiles = declIndex.get(sym);
      if (!declaringFiles) continue;
      for (const to of declaringFiles) {
        if (to === path) continue;
        const key = `${path}\0${to}\0static`;
        const existing = edgeMap.get(key);
        if (existing) {
          if (!existing.symbols.includes(sym)) {
            edgeMap.set(key, { ...existing, symbols: [...existing.symbols, sym] });
          }
        } else {
          edgeMap.set(key, {
            from: path,
            to,
            type: "static" as ImportType,
            symbols: [sym],
          });
        }
      }
    }
  }

  return {
    edges: [...edgeMap.values()],
    external: [...externalMap.values()],
  };
}
