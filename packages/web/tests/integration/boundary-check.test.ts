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

/**
 * Extract only runtime (non-type-only) import paths from a TypeScript file.
 * Skips `import type { ... }` and `export type { ... }` — those are erased
 * by the compiler and create no runtime coupling.
 */
function extractRuntimeImportPaths(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const paths: string[] = [];
  // Same as extractImportPaths but with a negative lookahead for `type\s`
  // to exclude `import type` / `export type` forms.
  const re = /(?:import|export)\s+(?!type\s)(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
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
   * - loader/ — viewer data loading (barrel: loader/index.ts)
   * - polling/ — viewer polling lifecycle (barrel: polling/index.ts)
   *
   * Panel is a logical zone (Louvain classification), not a physical directory,
   * so it does not require barrel enforcement.
   */
  it("imports to viewer sub-zones must go through barrel files", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    // Sub-zones with declared barrel files (relative to viewer/)
    const BARREL_ZONES = ["crash", "loader", "polling"];

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
   * Components barrel enforcement — files outside the components/ directory
   * must import through components/index.ts rather than individual component
   * files. The protected set is derived dynamically from the filesystem so
   * new files are covered automatically without updating this test.
   *
   * This enforces the barrel contract that exists in components/index.ts
   * and prevents direct file imports from creating encapsulation leaks.
   */
  it("panel component imports from outside components/ must use barrel", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const componentsDir = join(viewerDir, "components");
    const violations: string[] = [];

    // Dynamically collect all component leaf files (excluding the barrel itself)
    let componentFiles: string[];
    try {
      componentFiles = readdirSync(componentsDir)
        .filter((f) => /\.ts$/.test(f) && f !== "index.ts")
        .map((f) => f.replace(/\.ts$/, ""));
    } catch {
      // components/ doesn't exist in test environment — pass
      return;
    }

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);

        // Files inside components/ can import freely from siblings
        if (rel.startsWith(join("viewer", "components") + "/")) continue;

        for (const imp of extractImportPaths(file)) {
          for (const component of componentFiles) {
            if (imp.includes(`/components/${component}`) && !imp.includes("/index")) {
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
   * Viewer → server runtime import guard.
   *
   * The viewer is built separately and served as static assets; it must
   * never carry a runtime dependency on server-side modules. Type-only
   * imports (`import type`) are erased by the TypeScript compiler and do
   * not create build-time coupling, but any runtime import would pull
   * server code into the viewer bundle.
   *
   * The companion test "no viewer file imports from server" (below) is
   * zero-tolerance for ALL import forms. This test makes the runtime
   * constraint explicit so that the intent is clear when reviewing diffs.
   */
  it("no viewer file has runtime imports from server", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractRuntimeImportPaths(file)) {
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

  /**
   * web-shared barrel import enforcement — consumers of src/shared/ must import
   * through shared/index.ts rather than directly from leaf files (data-files.ts,
   * view-id.ts). Direct imports erode measurable cohesion and prevent per-module
   * consumer counting required by the two-consumer governance rule.
   *
   * Exemptions:
   * - viewer/crash/ — documented exemption for ViewId (cycle avoidance)
   * - viewer/messaging/ — documented exemption for shared/ direct access
   */
  it("shared/ consumers import through barrel, not leaf files", () => {
    const violations: string[] = [];
    const SHARED_LEAF_FILES = ["data-files", "view-id", "features"];

    try {
      for (const dir of ["server", "viewer"]) {
        const base = join(WEB_SRC, dir);
        for (const file of collectTsFiles(base)) {
          const rel = relative(WEB_SRC, file);

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

  /**
   * Two-consumer rule for web-shared — every module in src/shared/ must have
   * at least two distinct consumer zones (directories under src/) to justify
   * its placement in the shared foundation layer. Single-consumer utilities
   * should live closer to their dominant use site.
   *
   * This enforces the governance rule from CLAUDE.md:
   * > A new module must have at least two distinct consumer zones before
   * > being added. Single-consumer utilities belong closer to their
   * > dominant use site.
   */
  it("shared/ modules have at least two consumer zones", () => {
    const sharedDir = join(WEB_SRC, "shared");

    // Collect leaf module names exported from shared/
    let sharedModules: string[];
    try {
      sharedModules = readdirSync(sharedDir)
        .filter((f) => /\.ts$/.test(f) && f !== "index.ts")
        .map((f) => f.replace(/\.ts$/, ""));
    } catch {
      // shared/ doesn't exist in test environment — pass
      return;
    }

    // For each shared module, count distinct top-level zone directories that import it
    const violations: string[] = [];

    for (const mod of sharedModules) {
      const consumerZones = new Set<string>();

      // Scan all TS files under src/
      for (const dir of ["server", "viewer"]) {
        const base = join(WEB_SRC, dir);
        try {
          for (const file of collectTsFiles(base)) {
            for (const imp of extractImportPaths(file)) {
              // Match both barrel imports (shared/index) and direct imports (shared/<mod>)
              if (imp.includes(`shared/${mod}`) || imp.includes("shared/index")) {
                const rel = relative(WEB_SRC, file);
                // Extract the top-level zone: "server", "viewer", or "viewer/<subzone>"
                const parts = rel.split("/");
                const zone = parts[0] === "viewer" && parts.length > 2
                  ? `${parts[0]}/${parts[1]}`
                  : parts[0]!;
                consumerZones.add(zone);
              }
            }
          }
        } catch {
          // Directory doesn't exist — skip
        }
      }

      if (consumerZones.size < 2) {
        violations.push(
          `shared/${mod}.ts has ${consumerZones.size} consumer zone(s) [${[...consumerZones].join(", ")}] — requires at least 2`
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * viewer-prd-interaction zone containment — the zone has dual-fragility
   * metrics (cohesion 0.26, coupling 0.74) and its hooks (use-toast,
   * use-feature-toggle) are single-consumer utilities consumed only by
   * views/prd.ts. This assertion prevents external zone expansion by
   * failing if a file outside the known zone consumes these hooks directly.
   *
   * If a second consumer legitimately needs one of these hooks, consider
   * moving it to web-viewer hub (which dissolves the dual-fragility
   * classification) rather than expanding the fragile zone's surface.
   */
  it("viewer-prd-interaction hooks are not consumed outside the zone", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const violations: string[] = [];

    // Files that compose the viewer-prd-interaction zone
    const ZONE_FILES = new Set([
      join("viewer", "views", "prd.ts"),
      join("viewer", "components", "prd-tree", "bulk-actions.ts"),
      join("viewer", "hooks", "use-toast.ts"),
      join("viewer", "hooks", "use-feature-toggle.ts"),
    ]);

    // Hook file stems that must stay contained
    const CONTAINED_HOOKS = ["use-toast", "use-feature-toggle"];

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);

        // Files inside the zone can import freely
        if (ZONE_FILES.has(rel)) continue;

        // The hooks barrel (index.ts) re-exports all hooks including contained ones —
        // it is a passthrough, not a consumer
        if (rel === join("viewer", "hooks", "index.ts")) continue;

        for (const imp of extractImportPaths(file)) {
          for (const hook of CONTAINED_HOOKS) {
            if (imp.includes(`/${hook}`) || imp.endsWith(hook) || imp.endsWith(`${hook}.js`)) {
              violations.push(
                `${rel} imports "${imp}" — ${hook} is contained to viewer-prd-interaction zone`
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

  /**
   * Exhaustive allowlist for server → viewer imports.
   *
   * The server must never import from the viewer — the viewer is built
   * separately and served as static assets. This test uses a counted
   * allowlist (currently 0) to ensure new reverse imports are explicitly
   * reviewed rather than silently passing.
   *
   * If a legitimate server → viewer import is needed, add it to the
   * ALLOWED_SERVER_TO_VIEWER list below with a justification.
   */
  it("server → viewer imports are exhaustively tracked (currently zero)", () => {
    const serverDir = join(WEB_SRC, "server");
    const ALLOWED_SERVER_TO_VIEWER: string[] = [
      // No allowed imports — the boundary must be zero-crossing.
      // If you need to add one, document WHY the import is necessary
      // and whether the symbol should be extracted to web-shared instead.
    ];

    const found: string[] = [];

    try {
      for (const file of collectTsFiles(serverDir)) {
        const rel = relative(WEB_SRC, file);
        for (const imp of extractImportPaths(file)) {
          if (imp.includes("/viewer/") || imp.match(/\.\.\/viewer\b/)) {
            found.push(`${rel} imports "${imp}"`);
          }
        }
      }
    } catch {
      // serverDir doesn't exist in test environment — pass
      return;
    }

    // Fail if any unlisted import appears
    const unlisted = found.filter((f) => !ALLOWED_SERVER_TO_VIEWER.includes(f));
    expect(unlisted).toEqual([]);

    // Fail if allowlist has stale entries
    const stale = ALLOWED_SERVER_TO_VIEWER.filter((a) => !found.includes(a));
    if (stale.length > 0) {
      expect.fail(
        `ALLOWED_SERVER_TO_VIEWER contains stale entries:\n${stale.map((s) => `  - ${s}`).join("\n")}\n\nRemove them — the import no longer exists.`
      );
    }
  });

  /**
   * General-purpose viewer hooks coupling guard.
   *
   * Hooks in viewer/hooks/ with zero external zone imports are
   * general-purpose utilities. As the hook count grows, this assertion
   * prevents silent coupling expansion by requiring that any hook
   * consumed outside its declaring zone is explicitly documented.
   *
   * Current policy: use-toast and use-feature-toggle are contained to
   * the viewer-prd-interaction zone (see the "viewer-prd-interaction
   * hooks are not consumed outside the zone" assertion above). This
   * test adds a forward-looking guard: if a NEW general-purpose hook
   * is added and consumed across zones, it must be documented here.
   */
  it("general-purpose hooks have bounded cross-zone consumers", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const hooksDir = join(viewerDir, "hooks");

    // Hooks that are currently contained (single-zone consumers)
    const CONTAINED_HOOKS = new Set(["use-toast", "use-feature-toggle"]);

    let hookFiles: string[];
    try {
      hookFiles = readdirSync(hooksDir)
        .filter((f) => /^use-.*\.ts$/.test(f))
        .map((f) => f.replace(/\.ts$/, ""));
    } catch {
      return;
    }

    // For each hook, check if it has zero external imports (general-purpose)
    const generalPurposeHooks: string[] = [];
    for (const hook of hookFiles) {
      const hookPath = join(hooksDir, `${hook}.ts`);
      const imports = extractImportPaths(hookPath);
      const hasExternalZoneImport = imports.some(
        (imp) => imp.startsWith("..") && !imp.includes("/hooks/")
      );
      if (!hasExternalZoneImport && !CONTAINED_HOOKS.has(hook)) {
        generalPurposeHooks.push(hook);
      }
    }

    // General-purpose hooks that are NOT in the contained set should
    // still be consumed within their declaring zone only. If they
    // expand to cross-zone use, add them to CONTAINED_HOOKS or
    // create a barrel.
    for (const hook of generalPurposeHooks) {
      const violations: string[] = [];
      try {
        for (const file of collectTsFiles(viewerDir)) {
          const rel = relative(WEB_SRC, file);
          if (rel.startsWith(join("viewer", "hooks") + "/")) continue;

          for (const imp of extractImportPaths(file)) {
            if (
              imp.includes(`/${hook}`) ||
              imp.endsWith(hook) ||
              imp.endsWith(`${hook}.js`)
            ) {
              violations.push(rel);
            }
          }
        }
      } catch {
        continue;
      }

      // Allow up to 3 consumers before requiring documentation
      if (violations.length > 3) {
        expect.fail(
          `Hook ${hook} has ${violations.length} consumers outside hooks/ — add to CONTAINED_HOOKS or create a barrel:\n${violations.map((v) => `  - ${v}`).join("\n")}`
        );
      }
    }
  });

  /**
   * Hooks barrel enforcement — imports to viewer/hooks/ from outside the hooks
   * directory must use the hooks/index.ts barrel rather than direct leaf imports.
   *
   * This mirrors the crash/ and shared/ barrel enforcement pattern and creates
   * a stable public contract for the hooks directory (27 files).
   *
   * Exemptions:
   * - viewer/hooks/ files can import from siblings freely
   * - The barrel itself (hooks/index.ts) is not checked
   */
  it("hooks consumers import through barrel, not leaf files", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const hooksDir = join(viewerDir, "hooks");
    const violations: string[] = [];

    let hookLeafFiles: string[];
    try {
      hookLeafFiles = readdirSync(hooksDir)
        .filter((f) => /\.ts$/.test(f) && f !== "index.ts")
        .map((f) => f.replace(/\.ts$/, ""));
    } catch {
      // hooks/ doesn't exist in test environment — pass
      return;
    }

    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);

        // Files inside hooks/ can import from siblings freely
        if (rel.startsWith(join("viewer", "hooks") + "/")) continue;

        for (const imp of extractImportPaths(file)) {
          for (const hook of hookLeafFiles) {
            // Match direct imports like "./hooks/use-polling" or "../hooks/use-polling.js"
            // but not "./hooks/index" or "./hooks"
            if (
              (imp.includes(`hooks/${hook}`) || imp.includes(`hooks/${hook}.js`)) &&
              !imp.includes("hooks/index")
            ) {
              violations.push(
                `${rel} imports "${imp}" — must use hooks/index.js barrel`
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
   * viewer-ui-hub gateway compliance guard.
   *
   * viewer-ui-hub (sidebar, search-overlay, config-footer, faq, logos, theme-toggle)
   * is the intentional Preact UI composition hub. Its dual-fragility metrics
   * (cohesion 0.38, coupling 0.63) and bidirectional 74-edge coupling with the
   * web dashboard platform zone are structurally expected — but the coupling must
   * not grow from undisciplined leaf reaches.
   *
   * Two rules enforced here:
   *
   * 1. viewer-ui-hub component files must import cross-zone symbols through
   *    api.js (the inbound viewer gateway), not by reaching directly into
   *    hooks/ leaf files, types.ts, or route-state.ts.
   *
   * 2. Files outside the viewer-ui-hub zone must not bypass components/index.ts
   *    to import leaf component files (config-footer, faq, logos, search-overlay,
   *    sidebar, theme-toggle) directly.
   *
   * @see CLAUDE.md — viewer-ui-hub governance
   */
  it("viewer-ui-hub components comply with gateway and barrel rules", () => {
    const viewerDir = join(WEB_SRC, "viewer");
    const componentsDir = join(viewerDir, "components");
    const hooksDir = join(viewerDir, "hooks");
    const violations: string[] = [];

    // The ui-hub leaf files (not the barrel itself)
    const UI_HUB_LEAVES = new Set([
      "config-footer",
      "faq",
      "logos",
      "search-overlay",
      "sidebar",
      "theme-toggle",
    ]);

    // Hooks leaf files (must NOT be imported directly from ui-hub — use api.js)
    let hookLeafFiles: string[];
    try {
      hookLeafFiles = readdirSync(hooksDir)
        .filter((f) => /^use-.*\.ts$/.test(f) && f !== "index.ts")
        .map((f) => f.replace(/\.ts$/, ""));
    } catch {
      hookLeafFiles = [];
    }

    // Rule 1 — ui-hub component files must not reach directly into hooks/ leaf files,
    // types.ts, or route-state.ts. Cross-zone imports must flow through api.js.
    for (const leaf of UI_HUB_LEAVES) {
      const filePath = join(componentsDir, `${leaf}.ts`);
      let imports: string[];
      try {
        imports = extractImportPaths(filePath);
      } catch {
        continue; // file absent in test env — skip
      }

      for (const imp of imports) {
        // Direct hook leaf reach-in (bypassing api.js)
        for (const hook of hookLeafFiles) {
          if (imp.includes(`hooks/${hook}`) && !imp.includes("hooks/index")) {
            violations.push(
              `components/${leaf}.ts imports hook leaf "${imp}" — must use ../api.js`
            );
          }
        }
        // Direct reach into types.ts or route-state.ts (bypassing api.js)
        if (
          imp.match(/\.\.\/types(\.js)?$/) ||
          imp.match(/\.\.\/route-state(\.js)?$/)
        ) {
          violations.push(
            `components/${leaf}.ts imports "${imp}" — must use ../api.js`
          );
        }
      }
    }

    // Rule 2 — files outside the ui-hub zone must not bypass components/index.ts
    // to leaf-import ui-hub component files.
    try {
      for (const file of collectTsFiles(viewerDir)) {
        const rel = relative(WEB_SRC, file);

        // Files inside the components/ directory can import siblings freely
        if (rel.startsWith(join("viewer", "components") + "/")) continue;

        for (const imp of extractImportPaths(file)) {
          for (const leaf of UI_HUB_LEAVES) {
            if (
              (imp.includes(`components/${leaf}`) ||
                imp.includes(`components/${leaf}.js`)) &&
              !imp.endsWith("components/index") &&
              !imp.endsWith("components/index.js") &&
              !imp.endsWith("components")
            ) {
              violations.push(
                `${rel} imports ui-hub leaf "${imp}" — must use components/index.js barrel`
              );
            }
          }
        }
      }
    } catch {
      // viewerDir doesn't exist in test environment — pass
    }

    expect(violations).toEqual([]);
  });
});
