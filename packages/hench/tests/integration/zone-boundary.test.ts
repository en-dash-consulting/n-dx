/**
 * Intra-zone boundary assertions for the hench autonomous-agent zone.
 *
 * Prevents sub-zone drift as the codebase grows past 200+ files.
 * Three invariants are enforced:
 *
 *   1. CLI isolation — cli/ is the consumer tier; no domain/infrastructure
 *      zone imports from it (imports flow downward, never upward to the CLI).
 *
 *   2. Infrastructure independence — process/, queue/, schema/, store/, types/,
 *      and validation/ don't import from the agent/ orchestration zone.
 *
 *   3. Barrel enforcement — when a zone's index.ts re-exports a leaf file,
 *      consumers outside that zone must import through the barrel, not the leaf.
 *
 * ## Known limitations (inherited from the regex-based approach)
 *
 * Dynamic imports (`import("./path")`), template-literal paths, and import
 * statements split across multiple lines may be missed. See the matching note
 * in packages/web/tests/integration/boundary-check.test.ts.
 *
 * @see packages/web/tests/integration/boundary-check.test.ts — pattern reference
 * @see CLAUDE.md §hench-agent-internal-governance
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const HENCH_SRC = join(import.meta.dirname!, "..", "..", "src");

/** Recursively collect all .ts source files under a directory. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Extract all import paths from a TypeScript file (both type and runtime).
 * Uses a regex — see file-level limitations note.
 */
function extractImportPaths(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const paths: string[] = [];
  const re =
    /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    paths.push(m[1]!);
  }
  return paths;
}

/**
 * Parse a barrel index.ts and return the set of local leaf file stems that it
 * re-exports. A stem is the path without the `.js` extension, e.g.
 * `"./memory-monitor"` for `export { ... } from "./memory-monitor.js"`.
 */
function barrelLeafStems(indexPath: string): Set<string> {
  if (!existsSync(indexPath)) return new Set();
  const content = readFileSync(indexPath, "utf-8");
  const stems = new Set<string>();
  const re = /from\s+["'](\.\/[^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    stems.add(m[1]!.replace(/\.js$/, ""));
  }
  return stems;
}

/** Returns true if the import path references the given zone name. */
function importsFromZone(imp: string, zone: string): boolean {
  return imp.includes(`/${zone}/`) || imp.endsWith(`/${zone}`);
}

// ---------------------------------------------------------------------------
// 1. CLI isolation
// ---------------------------------------------------------------------------

describe("hench intra-zone boundaries — CLI isolation", () => {
  it("no non-cli zone imports from cli/", () => {
    const zones = readdirSync(HENCH_SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "cli")
      .map((e) => e.name);

    const violations: string[] = [];
    for (const zone of zones) {
      for (const file of collectTsFiles(join(HENCH_SRC, zone))) {
        const rel = relative(HENCH_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (importsFromZone(imp, "cli")) {
            violations.push(`${rel} imports "${imp}"`);
          }
        }
      }
    }

    expect(
      violations,
      "cli/ must be the consumer tier — no domain or infrastructure zone may import from it",
    ).toEqual([]);
  });

  it("cli/errors.ts does not import from prd/", () => {
    const file = join(HENCH_SRC, "cli", "errors.ts");
    const violations = extractImportPaths(file)
      .filter((imp) => importsFromZone(imp, "prd"));

    expect(
      violations,
      "cli/errors.ts must not depend on prd/; shared error primitives belong in the foundation tier",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Infrastructure independence
// ---------------------------------------------------------------------------

describe("hench intra-zone boundaries — infrastructure independence", () => {
  const INFRA_ZONES = [
    "process",
    "queue",
    "schema",
    "store",
    "types",
    "validation",
  ] as const;

  for (const zone of INFRA_ZONES) {
    it(`${zone}/ does not import from agent/ or cli/`, () => {
      const zoneDir = join(HENCH_SRC, zone);
      const violations: string[] = [];

      for (const file of collectTsFiles(zoneDir)) {
        const rel = relative(HENCH_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (importsFromZone(imp, "agent") || importsFromZone(imp, "cli")) {
            violations.push(`${rel} imports "${imp}"`);
          }
        }
      }

      expect(
        violations,
        `${zone}/ is an infrastructure/foundation zone — it must not depend on agent/ or cli/`,
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Barrel enforcement
// ---------------------------------------------------------------------------

describe("hench intra-zone boundaries — barrel enforcement", () => {
  /**
   * For each infrastructure zone that has an index.ts barrel, assert that
   * agent/ files do not import any of its leaf files directly when those
   * leaves are already re-exported by the barrel.
   *
   * Non-barrel files (e.g. tools/contracts.ts, tools/rex.ts) are intentionally
   * excluded from the barrel and may be imported directly.
   */
  const BARREL_ZONES = ["process", "tools", "store", "schema", "queue", "quota"] as const;

  for (const zone of BARREL_ZONES) {
    it(`agent/ imports from ${zone}/ go through ${zone}/index.ts`, () => {
      const agentDir = join(HENCH_SRC, "agent");
      const barrelPath = join(HENCH_SRC, zone, "index.ts");
      const leafStems = barrelLeafStems(barrelPath);

      // Build a pattern that matches cross-zone imports into this zone:
      // e.g.  "../../process/memory-monitor.js"
      const zoneLeafRe = new RegExp(
        `^\\.\\.\\/\\.\\.\\/` + zone + `\\/(\\w[\\w-]*)(?:\\.js)?$`,
      );

      const violations: string[] = [];
      for (const file of collectTsFiles(agentDir)) {
        const rel = relative(HENCH_SRC, file);
        for (const imp of extractImportPaths(file)) {
          const match = imp.match(zoneLeafRe);
          if (match && match[1] !== "index") {
            const stem = `./${match[1]}`;
            if (leafStems.has(stem)) {
              violations.push(
                `${rel} imports "${imp}" directly — use "../../${zone}/index.js" instead`,
              );
            }
          }
        }
      }

      expect(
        violations,
        `agent/ must import ${zone}/ symbols through the ${zone}/index.js barrel`,
      ).toEqual([]);
    });
  }
});
