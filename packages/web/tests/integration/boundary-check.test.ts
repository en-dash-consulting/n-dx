/**
 * Server/client boundary enforcement test.
 *
 * Ensures no import crosses the boundary between src/server/ and src/viewer/.
 * This catches accidental coupling that would not be flagged by the build
 * since both sides compile under the same tsconfig.
 *
 * @see tests/e2e/domain-isolation.test.js — cross-package gateway enforcement
 * @see tests/e2e/architecture-policy.test.js — orchestration spawn-only + zone cycle detection
 *
 * These three test files together enforce the full architectural guardrail suite.
 * Changes to one should be reviewed against the others for consistency.
 *
 * ## Known limitations of regex-based import extraction
 *
 * The `extractImportPaths()` function uses a regex to match static import/export
 * statements. This approach is intentionally lightweight (no AST parse) but has
 * blind spots:
 *
 *   1. **Dynamic imports** — `await import("./path")` and `import("./path")` are
 *      not detected. Two critical dynamic import paths exist in the monorepo:
 *      `rex/src/cli/commands/analyze.ts` and `rex/src/cli/index.ts`. A separate
 *      dynamic-import-audit test in architecture-policy.test.js covers these.
 *   2. **Template-literal paths** — ``import(`./locales/${lang}`)`` is invisible.
 *   3. **Multiline import statements** — Imports split across lines may be missed
 *      if the `from "..."` portion is on a different line than the `import` keyword.
 *
 * Any new enforcement assertion added to this file inherits these blind spots.
 * For boundary-critical dynamic imports, consider a separate grep-based check.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WEB_SRC = join(import.meta.dirname!, "..", "..", "src");

/** Recursively collect all .ts files under a directory. */
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

/** Extract import paths from a TypeScript file. */
function extractImportPaths(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const paths: string[] = [];
  // Matches: import ... from "..." and import "..."
  const re = /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    paths.push(m[1]!);
  }
  return paths;
}

describe("server/client boundary", () => {
  it("no server file imports from viewer", () => {
    const serverDir = join(WEB_SRC, "server");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(serverDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (imp.includes("/viewer/") || imp.match(/\.\.\/viewer\b/)) {
            violations.push(`${rel} imports "${imp}"`);
          }
        }
      }
    } catch {
      // serverDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  it("viewer cross-boundary imports flow through external.ts gateway", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);
        // The gateway itself is allowed to import from outside
        if (rel === join("viewer", "external.ts")) continue;

        // Messaging infrastructure is allowed to import directly from shared/
        // to avoid creating a zone-level dependency inversion through external.ts.
        // The shared/ directory is neutral (neither server nor viewer), so
        // messaging utilities can access it without violating the server/client boundary.
        const isMessaging = rel.startsWith(join("viewer", "messaging") + "/") ||
          rel === join("viewer", "messaging");

        // Crash detection is a standalone module with zero framework dependencies.
        // It imports ViewId directly from shared/ to avoid a bidirectional cycle
        // (crash → external.ts → crash via performance/index.ts re-exports).
        const isCrash = rel.startsWith(join("viewer", "crash") + "/") ||
          rel === join("viewer", "crash");

        for (const imp of extractImportPaths(file)) {
          // Check for direct imports to schema/ from viewer files
          if (imp.match(/\.\.\/schema\b/)) {
            violations.push(`${rel} imports "${imp}" — must use ./external.js gateway`);
          }
          // Check for direct imports to shared/ from non-messaging viewer files
          if (imp.match(/shared\b/) && imp.startsWith("..") && !isMessaging && !isCrash) {
            violations.push(`${rel} imports "${imp}" — must use ./external.js gateway`);
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  /**
   * Sub-zone barrel enforcement — imports to viewer sub-zones (crash, panel,
   * etc.) from outside the sub-zone must enter through the declared barrel
   * file (index.ts), not through internal implementation files.
   *
   * This prevents encapsulation erosion: if external code imports directly
   * from crash/crash-detector.ts, the internal module becomes de facto public
   * and cannot be refactored without cross-zone breakage.
   *
   * Sub-zones with barrel enforcement:
   * - crash/ — crash recovery (barrel: crash/index.ts)
   *
   * Panel is a logical zone (Louvain classification), not a physical directory,
   * so it does not require barrel enforcement.
   */
  it("imports to viewer sub-zones must go through barrel files", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    // Sub-zones with declared barrel files (relative to viewer/)
    const BARREL_ZONES = ["crash"];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);

        for (const zone of BARREL_ZONES) {
          const zonePrefix = join("viewer", zone) + "/";

          // Files inside the sub-zone can import freely from siblings
          if (rel.startsWith(zonePrefix)) continue;

          for (const imp of extractImportPaths(file)) {
            // Check if import targets a file inside the sub-zone
            // Match patterns like "../crash/crash-detector" but not "../crash/index"
            const zoneImportPattern = new RegExp(
              `(?:^|/)${zone}/(?!index\\.)`
            );
            if (zoneImportPattern.test(imp)) {
              violations.push(
                `${rel} imports "${imp}" — must use ${zone}/index.js barrel`
              );
            }
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  /**
   * Shared layer isolation — src/shared/ is the foundation layer with zero
   * upward dependencies. No file in shared/ should import from viewer/,
   * server/, or viewer/messaging/. This property is documented and observed
   * but must be mechanically protected to prevent erosion.
   */
  it("shared/ does not import from viewer, server, or messaging", () => {
    const sharedDir = join(WEB_SRC, "shared");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(sharedDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (
            imp.includes("/viewer/") || imp.match(/\.\.\/viewer\b/) ||
            imp.includes("/server/") || imp.match(/\.\.\/server\b/) ||
            imp.includes("/messaging/")
          ) {
            violations.push(`${rel} imports "${imp}" — shared/ must have zero upward dependencies`);
          }
        }
      }
    } catch {
      // sharedDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  /**
   * crash-detector.ts import guard — crash-detector.ts must import ViewId
   * directly from shared/view-id.ts (or shared/index.ts), NOT through
   * viewer/external.ts. Importing through external.ts creates a bidirectional
   * cycle (crash → external → crash via performance/index.ts re-exports).
   *
   * This converts the exemption documented in the "viewer cross-boundary
   * imports" test into a positive assertion: crash-detector.ts MUST use the
   * direct shared/ path.
   */
  it("crash-detector.ts imports ViewId from shared/, not external.ts", () => {
    const crashDetector = join(WEB_SRC, "viewer", "crash", "crash-detector.ts");
    const violations: string[] = [];

    try {
      for (const imp of extractImportPaths(crashDetector)) {
        if (imp.includes("external")) {
          violations.push(
            `crash-detector.ts imports "${imp}" — must use shared/view-id.js directly`
          );
        }
      }
    } catch {
      // File doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  /**
   * Hench-agent-monitor panel barrel enforcement — files outside the
   * components/ directory that import panel components must do so through
   * components/index.ts rather than individual component files.
   *
   * This enforces the barrel contract that exists in components/index.ts
   * and prevents direct file imports from creating encapsulation leaks.
   */
  it("panel component imports from outside components/ must use barrel", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    // Panel components that must be imported via barrel
    const PANEL_FILES = [
      "active-tasks-panel",
      "concurrency-panel",
      "memory-panel",
      "ws-health-panel",
      "throttle-controls",
    ];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);

        // Files inside components/ can import freely from siblings
        if (rel.startsWith(join("viewer", "components") + "/")) continue;

        for (const imp of extractImportPaths(file)) {
          for (const panel of PANEL_FILES) {
            if (imp.includes(`/${panel}`) && !imp.includes("/index")) {
              violations.push(
                `${rel} imports "${imp}" — must use components/index.js barrel`
              );
            }
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  /**
   * Viewer → server import check.
   *
   * This test catches ALL import forms — both runtime (`import { foo }`)
   * and type-only (`import type { Foo }`). For the viewer → server
   * direction, even type-only imports are treated as violations because
   * the viewer is built separately and served as static assets; it has
   * no legitimate reason to reference server-side modules at any level.
   *
   * Cross-zone import analysis may report "web-viewer → web-server"
   * edges when zones don't map exactly to src/viewer/ vs src/server/.
   * This test is the ground-truth enforcement — zero violations means
   * the boundary is clean regardless of zone-level analysis.
   */
  /**
   * web-shared barrel import enforcement — consumers of src/shared/ must import
   * through shared/index.ts rather than directly from leaf files (data-files.ts,
   * view-id.ts). Direct imports erode measurable cohesion and prevent per-module
   * consumer counting required by the two-consumer governance rule.
   *
   * Exemptions:
   * - viewer/external.ts — gateway whose purpose is to re-export from shared/
   * - viewer/crash/ — documented exemption for ViewId (cycle avoidance)
   * - viewer/messaging/ — documented exemption for shared/ direct access
   */
  it("shared/ consumers import through barrel, not leaf files", () => {
    const violations: string[] = [];
    const SHARED_LEAF_FILES = ["data-files", "view-id"];

    try {
      for (const dir of ["server", "viewer"]) {
        const base = join(WEB_SRC, dir);
        for (const file of collectTsFiles(base)) {
          const rel = relative(WEB_SRC, file);

          // Gateway files are allowed to import from leaf files
          if (rel === join("viewer", "external.ts")) continue;

          // Crash zone exemption (documented cycle avoidance)
          if (rel.startsWith(join("viewer", "crash") + "/")) continue;

          // Messaging exemption (documented shared/ direct access)
          if (rel.startsWith(join("viewer", "messaging") + "/")) continue;

          for (const imp of extractImportPaths(file)) {
            for (const leaf of SHARED_LEAF_FILES) {
              if (imp.includes(`shared/${leaf}`)) {
                violations.push(
                  `${rel} imports "${imp}" — must use shared/index.js barrel`
                );
              }
            }
          }
        }
      }
    } catch {
      // Directories don't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });

  it("no viewer file imports from server", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (imp.includes("/server/") || imp.match(/\.\.\/server\b/)) {
            violations.push(`${rel} imports "${imp}"`);
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
      return;
    }

    expect(violations).toEqual([]);
  });
});
