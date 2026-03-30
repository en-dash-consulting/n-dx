/**
 * Domain layer isolation tests — automated enforcement of the four-tier
 * dependency hierarchy and gateway pattern.
 *
 * The architecture defines strict import rules:
 *
 * ```
 *   Orchestration   cli.js, web.js, ci.js        (spawns CLIs, no library imports)
 *        ↓
 *   Execution       hench                         (imports rex only, via gateway)
 *        ↓
 *   Domain          rex · sourcevision            (independent, never import each other)
 *        ↓
 *   Foundation      @n-dx/llm-client              (shared types, API client)
 * ```
 *
 * ## Policies enforced
 *
 * 1. **Domain isolation** — rex and sourcevision must never import each other.
 * 2. **Upward isolation** — domain packages must not import from execution
 *    or orchestration layers (rex/sourcevision must not import from hench or web).
 * 3. **Gateway enforcement** — cross-package runtime imports in hench and web
 *    must flow through designated gateway modules, not scattered leaf files.
 *    `import type` is excluded (erased at compile time, zero runtime coupling).
 *
 * @see CLAUDE.md — Architecture section
 * @see PACKAGE_GUIDELINES.md — Gateway pattern reference
 * @see packages/web/tests/integration/boundary-check.test.ts — intra-package server/viewer boundary
 * @see tests/e2e/architecture-policy.test.js — orchestration spawn-only + zone cycle detection
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** Directories to skip entirely. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".hench",
  ".rex",
  ".sourcevision",
]);

/**
 * Recursively collect source files (.ts, .js, .mjs), excluding
 * declaration files and skipped directories.
 */
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Find runtime (non-type-only) imports from a specific package in file content.
 * Returns true if the file has a runtime import from the given package.
 *
 * Matches: `import { foo } from "pkg"`, `export { foo } from "pkg"`
 * Excludes: `import type { Foo } from "pkg"`, `export type { Foo } from "pkg"`
 */
function hasRuntimeImportFrom(content, pkg) {
  // Match import/export statements that reference the package.
  // We need to exclude `import type` and `export type` forms.
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Check for import/export from the package
    const fromPkg = new RegExp(`from\\s+["']${pkg}["']`);
    if (!fromPkg.test(trimmed)) continue;

    // If it's a type-only import/export, skip it
    if (/^import\s+type\s/.test(trimmed)) continue;
    if (/^export\s+type\s/.test(trimmed)) continue;

    // It's a runtime import
    return true;
  }
  return false;
}

describe("hasRuntimeImportFrom self-tests", () => {
  it("detects runtime import from a package", () => {
    expect(hasRuntimeImportFrom('import { foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(true);
    expect(hasRuntimeImportFrom('export { bar } from "@n-dx/rex"', "@n-dx/rex")).toBe(true);
    expect(hasRuntimeImportFrom('import foo from "@n-dx/sourcevision"', "@n-dx/sourcevision")).toBe(true);
  });

  it("excludes type-only imports", () => {
    expect(hasRuntimeImportFrom('import type { Foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(false);
    expect(hasRuntimeImportFrom('export type { Bar } from "@n-dx/rex"', "@n-dx/rex")).toBe(false);
  });

  it("excludes comments", () => {
    expect(hasRuntimeImportFrom('// import { foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(false);
    expect(hasRuntimeImportFrom('* import { foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(false);
  });

  it("does not match unrelated packages", () => {
    expect(hasRuntimeImportFrom('import { foo } from "@n-dx/rex"', "@n-dx/sourcevision")).toBe(false);
  });
});

/**
 * Find type-only imports from a specific package in file content.
 * Returns true if the file has `import type { ... } from "pkg"`.
 */
function hasTypeImportFrom(content, pkg) {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    const fromPkg = new RegExp(`from\\s+["']${pkg}["']`);
    if (!fromPkg.test(trimmed)) continue;

    if (/^import\s+type\s/.test(trimmed)) return true;
  }
  return false;
}

describe("hasTypeImportFrom self-tests", () => {
  it("detects type-only imports", () => {
    expect(hasTypeImportFrom('import type { Foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(true);
  });

  it("excludes runtime imports", () => {
    expect(hasTypeImportFrom('import { foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(false);
  });

  it("excludes export type re-exports", () => {
    expect(hasTypeImportFrom('export type { Foo } from "@n-dx/rex"', "@n-dx/rex")).toBe(false);
  });
});

describe("gateway-rules.json validation", () => {
  it("all gateway files referenced in gateway-rules.json exist on disk", () => {
    const stale = [];
    for (const rule of GATEWAY_RULES) {
      for (const gw of rule.gatewayFiles) {
        if (!existsSync(join(ROOT, gw))) {
          stale.push(gw);
        }
      }
    }
    if (stale.length > 0) {
      expect.fail(
        [
          "gateway-rules.json references gateway files that do not exist on disk.",
          "Update gateway-rules.json after renames/moves:",
          "",
          ...stale.map((s) => `  - ${s}`),
        ].join("\n"),
      );
    }
  });

  it("all consumer directories referenced in gateway-rules.json exist on disk", () => {
    const missing = [];
    for (const rule of GATEWAY_RULES) {
      if (!existsSync(join(ROOT, rule.packageDir))) {
        missing.push(rule.packageDir);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        [
          "gateway-rules.json references consumer directories that do not exist:",
          ...missing.map((m) => `  - ${m}`),
        ].join("\n"),
      );
    }
  });
});

/**
 * Domain-tier isolation policy.
 *
 * Rex and sourcevision sit at the domain layer and may import only from
 * @n-dx/llm-client (foundation). They are not listed in gateway-rules.json
 * because they have no cross-package runtime imports that require a gateway.
 * Foundation-tier imports are intentionally ungated — @n-dx/llm-client is the
 * shared bottom of the hierarchy, designed for direct use by all tiers.
 *
 * The tests below enforce domain isolation more strictly than the gateway
 * pattern: they block all imports from sibling domain or upper-layer packages,
 * not just un-gated ones.
 */
describe("architecture policy: domain layer isolation", () => {
  it("rex must not import from sourcevision, hench, or @n-dx/web", () => {
    const forbidden = ["@n-dx/sourcevision", "@n-dx/hench", "@n-dx/web"];
    const rexSrc = walk(join(ROOT, "packages/rex/src"));
    const violations = [];

    for (const file of rexSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const content = readFileSync(file, "utf-8");

      for (const pkg of forbidden) {
        // Check both runtime and type imports — domain packages should
        // have zero awareness of sibling domain or upper-layer packages
        const pattern = new RegExp(`from\\s+["']${pkg.replace("/", "\\/")}["']`);
        if (pattern.test(content)) {
          violations.push(`${rel} imports from "${pkg}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Rex must not import from sibling domain or upper-layer packages.",
          "Rex sits at the domain layer and may only import from @n-dx/llm-client (foundation).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "If rex needs functionality from another package, it should be:",
          "  - Pushed down to @n-dx/llm-client (if truly shared), or",
          "  - Coordinated via filesystem/CLI (loose coupling), or",
          "  - Restructured to avoid the dependency.",
        ].join("\n"),
      );
    }
  });

  it("sourcevision must not import from rex, hench, or @n-dx/web", () => {
    const forbidden = ["@n-dx/rex", "@n-dx/hench", "@n-dx/web"];
    const svSrc = walk(join(ROOT, "packages/sourcevision/src"));
    const violations = [];

    for (const file of svSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const content = readFileSync(file, "utf-8");

      for (const pkg of forbidden) {
        if (hasRuntimeImportFrom(content, pkg)) {
          violations.push(`${rel} imports from "${pkg}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Sourcevision must not import from sibling domain or upper-layer packages.",
          "Sourcevision sits at the domain layer and may only import from @n-dx/llm-client (foundation).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "If sourcevision needs functionality from another package, it should be:",
          "  - Pushed down to @n-dx/llm-client (if truly shared), or",
          "  - Coordinated via filesystem/CLI (loose coupling), or",
          "  - Restructured to avoid the dependency.",
        ].join("\n"),
      );
    }
  });

  /**
   * Domain packages must not contain hardcoded file paths that resolve into
   * sibling packages. Such paths create invisible tier-inversion edges that
   * bypass package.json dependency declarations and are undetectable by
   * standard import-graph tooling.
   *
   * This catches patterns like: resolve(__dirname, "../../../web/dist/...")
   * which create a build-time coupling between domain and upper-tier packages.
   */
  it("domain packages must not contain hardcoded cross-package file paths", () => {
    const DOMAIN_PKGS = [
      { name: "@n-dx/rex", dir: "rex" },
      { name: "@n-dx/sourcevision", dir: "sourcevision" },
    ];
    const SIBLING_DIRS = ["web", "hench", "rex", "sourcevision", "llm-client"];
    const violations = [];

    for (const pkg of DOMAIN_PKGS) {
      const srcDir = join(ROOT, `packages/${pkg.dir}/src`);
      if (!existsSync(srcDir)) continue;

      const files = walk(srcDir);
      for (const file of files) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const content = readFileSync(file, "utf-8");

        for (const sibling of SIBLING_DIRS) {
          if (sibling === pkg.dir) continue; // intra-package paths are fine
          // Match hardcoded relative paths that traverse into sibling packages
          // e.g. "../../../web/dist/..." or "../../rex/src/..."
          const pattern = new RegExp(`["']\\.\\./[^"']*/${sibling}/[^"']*["']`);
          if (pattern.test(content)) {
            violations.push(`${rel} contains hardcoded path into packages/${sibling}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Domain packages contain hardcoded file paths into sibling packages.",
          "These create invisible tier-inversion edges that bypass package.json.",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix: use workspace-root resolution, dynamic import.meta.resolve(),",
          "or delegate the cross-package call to the orchestration tier.",
        ].join("\n"),
      );
    }
  });
});

describe("architecture policy: orchestration tier boundary", () => {
  /**
   * Orchestration-tier files (cli.js, ci.js, web.js, and root-level service
   * files) must not import domain or execution packages as libraries. They
   * should spawn CLIs or use filesystem coordination instead.
   *
   * claude-integration.js is a root-level service file that participates
   * in the orchestration tier — it must follow the same rules.
   */
  const ORCHESTRATION_FILES = [
    "packages/core/cli.js",
    "packages/core/ci.js",
    "packages/core/web.js",
    "packages/core/config.js",
    "packages/core/pr-check.js",
    "packages/core/claude-integration.js",
  ];

  const DOMAIN_PACKAGES = ["@n-dx/rex", "@n-dx/sourcevision", "@n-dx/hench", "@n-dx/web"];

  for (const file of ORCHESTRATION_FILES) {
    it(`${file} must not have runtime imports from domain/execution packages`, () => {
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) return; // skip if file was removed

      const content = readFileSync(fullPath, "utf-8");
      const violations = [];

      for (const pkg of DOMAIN_PACKAGES) {
        if (hasRuntimeImportFrom(content, pkg)) {
          violations.push(pkg);
        }
      }

      if (violations.length > 0) {
        expect.fail(
          [
            `Orchestration-tier file ${file} has runtime imports from domain packages.`,
            "Orchestration files must spawn CLIs or coordinate via filesystem — no library imports.",
            "",
            `Imports from: ${violations.join(", ")}`,
            "",
            "Move the import into the relevant package or use child_process.spawn instead.",
          ].join("\n"),
        );
      }
    });
  }

  /**
   * config.js is spawn-exempt but must only import from node: builtins.
   * This prevents config.js from accumulating library imports beyond
   * filesystem I/O and child_process coordination.
   */
  it("config.js must only import from node: builtins", () => {
    const fullPath = join(ROOT, "packages/core/config.js");
    if (!existsSync(fullPath)) return;

    const content = readFileSync(fullPath, "utf-8");
    const lines = content.split("\n");
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      // Match static import declarations: import ... from "..."
      const importMatch = trimmed.match(/^import\s+.*from\s+["']([^"']+)["']/);
      if (!importMatch) continue;

      const source = importMatch[1];
      if (!source.startsWith("node:")) {
        violations.push(`line ${i + 1}: import from "${source}"`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "config.js is spawn-exempt but must only import from node: builtins.",
          "It should not accumulate library imports beyond config I/O.",
          "",
          "Non-node: imports found:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "Move the logic into the relevant package or use child_process.spawn instead.",
        ].join("\n"),
      );
    }
  });
});

/**
 * Gateway rules loaded from the shared gateway-rules.json.
 *
 * This is the single source of truth for gateway file paths and allowed
 * import patterns, shared with ci.js to prevent silent divergence.
 */
const _gatewayConfig = JSON.parse(readFileSync(join(ROOT, "packages/core/gateway-rules.json"), "utf-8"));

const GATEWAY_RULES = _gatewayConfig.gateways.map((g) => ({
  packageDir: g.consumer,
  externalPkg: g.externalPackage,
  gatewayFiles: new Set(g.gatewayFiles),
}));

describe("architecture policy: gateway enforcement", () => {
  /**
   * Dynamically generated tests from gateway-rules.json.
   *
   * Each gateway rule generates a test asserting that runtime imports from
   * the external package only occur in the designated gateway file(s).
   * `import type` is allowed anywhere (zero runtime coupling).
   */
  for (const rule of GATEWAY_RULES) {
    it(`${rule.packageDir} runtime imports from "${rule.externalPkg}" must go through gateway`, () => {
      const pkgSrc = walk(join(ROOT, rule.packageDir));
      const violations = [];

      for (const file of pkgSrc) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");

        // The gateway itself is allowed
        if (rule.gatewayFiles.has(rel)) continue;

        const content = readFileSync(file, "utf-8");
        if (hasRuntimeImportFrom(content, rule.externalPkg)) {
          violations.push(rel);
        }
      }

      if (violations.length > 0) {
        const gw = [...rule.gatewayFiles][0];
        expect.fail(
          [
            `Runtime imports from '${rule.externalPkg}' found outside the gateway.`,
            `All runtime imports must go through: ${gw}`,
            "`import type` is fine anywhere (erased at compile time).",
            "",
            "Violations:",
            ...violations.map((v) => `  - ${v}`),
            "",
            `To fix: import from the gateway instead of '${rule.externalPkg}' directly.`,
            `If a new export is needed, add it to ${gw} first.`,
          ].join("\n"),
        );
      }
    });
  }

  /**
   * Type-import gateway enforcement — closes the promotion erosion path.
   *
   * Even `import type { Foo } from "@n-dx/rex"` outside a gateway is an erosion
   * risk: a developer may later promote it to a runtime import during
   * refactoring, silently bypassing the gateway pattern. Routing all
   * imports (runtime AND type) through gateways eliminates this pathway.
   *
   * Exception: viewer files in the web package are exempt because the
   * server/viewer boundary prevents them from reaching the server-side
   * gateway. Type-only imports in viewer code are erased at compile time
   * and create zero runtime coupling.
   */
  const TYPE_IMPORT_EXEMPT_DIRS = new Set([
    "packages/web/src/viewer",
  ]);

  for (const rule of GATEWAY_RULES) {
    it(`${rule.packageDir} type imports from "${rule.externalPkg}" must go through gateway`, () => {
      const pkgSrc = walk(join(ROOT, rule.packageDir));
      const violations = [];

      for (const file of pkgSrc) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");

        // The gateway itself is allowed
        if (rule.gatewayFiles.has(rel)) continue;

        // Exempt directories (viewer can't reach server gateway due to boundary rule)
        let exempt = false;
        for (const dir of TYPE_IMPORT_EXEMPT_DIRS) {
          if (rel.startsWith(dir + "/")) { exempt = true; break; }
        }
        if (exempt) continue;

        const content = readFileSync(file, "utf-8");
        if (hasTypeImportFrom(content, rule.externalPkg)) {
          violations.push(rel);
        }
      }

      if (violations.length > 0) {
        const gw = [...rule.gatewayFiles][0];
        expect.fail(
          [
            `Type imports from '${rule.externalPkg}' found outside the gateway.`,
            `All imports (including type-only) must go through: ${gw}`,
            "This prevents type-import promotion from silently bypassing the gateway.",
            "",
            "Violations:",
            ...violations.map((v) => `  - ${v}`),
            "",
            `To fix: import the type from the gateway instead of '${rule.externalPkg}' directly.`,
            `If the type is not yet re-exported, add it to ${gw} first.`,
          ].join("\n"),
        );
      }
    });
  }

  /**
   * Gateway files must contain only re-export statements — no logic.
   *
   * The gateway pattern requires that gateway files are pure passthrough
   * modules: they re-export symbols from the upstream package and contain
   * no function bodies, class declarations, variable assignments, or any
   * other logic. This makes the cross-package surface auditable at a glance.
   *
   * This test walks each gateway file's content and asserts every meaningful
   * line is an export/re-export declaration, a type export, a comment, or
   * whitespace. Any logic (function, class, const, let, var, if, etc.)
   * triggers a failure.
   */
  for (const rule of GATEWAY_RULES) {
    for (const gwPath of rule.gatewayFiles) {
      it(`gateway ${gwPath} contains only re-exports (no logic)`, () => {
        const fullPath = join(ROOT, gwPath);
        if (!existsSync(fullPath)) return;

        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        const violations = [];

        // Track multi-line comment blocks
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          // Handle block comments
          if (inBlockComment) {
            if (trimmed.includes("*/")) {
              inBlockComment = false;
            }
            continue;
          }

          if (trimmed.startsWith("/*")) {
            if (!trimmed.includes("*/")) {
              inBlockComment = true;
            }
            continue;
          }

          // Allow: blank lines, single-line comments, export/re-export statements
          if (trimmed === "") continue;
          if (trimmed.startsWith("//")) continue;
          if (trimmed.startsWith("*")) continue; // JSDoc continuation

          // Allow: export { ... } from "..."  and  export type { ... } from "..."
          // These may span multiple lines, so also allow continuation lines
          // that are part of a multi-line export (contain only identifiers, commas, braces)
          if (/^export\s+(type\s+)?{/.test(trimmed)) continue;
          if (/^export\s+{/.test(trimmed)) continue;
          // Continuation of multi-line export: "  foo," or "  foo, bar," or "} from '...'"
          if (/^[A-Za-z_$][\w$]*\s*,?\s*$/.test(trimmed)) continue;
          if (/^}\s*from\s+["']/.test(trimmed)) continue;

          // Allow: @module, @see JSDoc tags (without leading *)
          if (/^@\w+/.test(trimmed)) continue;

          // Anything else is logic — flag it
          violations.push({ line: i + 1, content: trimmed });
        }

        if (violations.length > 0) {
          expect.fail(
            [
              `Gateway file ${gwPath} contains logic — gateways must be re-export-only.`,
              "Gateway files may only contain: export/re-export declarations, type exports, and comments.",
              "",
              "Violations:",
              ...violations.map((v) => `  line ${v.line}: ${v.content}`),
              "",
              "Move any logic to the upstream package or a local utility module.",
            ].join("\n"),
          );
        }
      });
    }
  }

  /**
   * Internal barrel enforcement — re-export-only check for intra-package
   * barrel files listed in gateway-rules.json's "internalBarrels".
   *
   * These files act as de facto gateways within a package (sole public
   * surface for a subsystem) but are not cross-package gateways. They
   * must still be re-export-only to prevent logic accumulation.
   */
  const internalBarrels = _gatewayConfig.internalBarrels || [];

  for (const barrel of internalBarrels) {
    it(`internal barrel ${barrel.file} contains only re-exports (no logic)`, () => {
      const fullPath = join(ROOT, barrel.file);
      if (!existsSync(fullPath)) return;

      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      const violations = [];

      let inBlockComment = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (inBlockComment) {
          if (trimmed.includes("*/")) {
            inBlockComment = false;
          }
          continue;
        }

        if (trimmed.startsWith("/*")) {
          if (!trimmed.includes("*/")) {
            inBlockComment = true;
          }
          continue;
        }

        if (trimmed === "") continue;
        if (trimmed.startsWith("//")) continue;
        if (trimmed.startsWith("*")) continue;

        if (/^export\s+(type\s+)?{/.test(trimmed)) continue;
        if (/^export\s+{/.test(trimmed)) continue;
        // Allow: namespace re-exports  export * as Name from "..."
        if (/^export\s+\*\s+as\s+\w+\s+from\s+["']/.test(trimmed)) continue;
        if (/^[A-Za-z_$][\w$]*\s*,?\s*$/.test(trimmed)) continue;
        if (/^}\s*from\s+["']/.test(trimmed)) continue;
        if (/^type\s+[A-Za-z_$][\w$]*\s*,?\s*$/.test(trimmed)) continue;
        if (/^@\w+/.test(trimmed)) continue;

        violations.push({ line: i + 1, content: trimmed });
      }

      if (violations.length > 0) {
        expect.fail(
          [
            `Internal barrel ${barrel.file} contains logic — barrels must be re-export-only.`,
            barrel.description,
            "",
            "Violations:",
            ...violations.map((v) => `  line ${v.line}: ${v.content}`),
            "",
            "Move any logic to an internal module within the subsystem.",
          ].join("\n"),
        );
      }
    });
  }

  /**
   * Data-layer contract: no source file may import from .rex/, .sourcevision/,
   * or .hench/ directories. These are data directories containing JSON state
   * files — they must be accessed via filesystem I/O, not module imports.
   *
   * This test complements the CI check in ci.js (checkDataLayerContract) to
   * provide redundant enforcement.
   */
  describe("data-layer contract", () => {
    const DATA_DIRS = [".rex", ".sourcevision", ".hench"];
    const allPackageSrc = [
      ...walk(join(ROOT, "packages/rex/src")),
      ...walk(join(ROOT, "packages/sourcevision/src")),
      ...walk(join(ROOT, "packages/hench/src")),
      ...walk(join(ROOT, "packages/web/src")),
      ...walk(join(ROOT, "packages/llm-client/src")),
    ];

    for (const dataDir of DATA_DIRS) {
      it(`no source file imports from ${dataDir}/`, () => {
        const escaped = dataDir.replace(".", "\\.");
        const pattern = new RegExp(
          `(?:from\\s+["'][^"']*\\/${escaped}\\/|from\\s+["']${escaped}\\/|require\\(["'][^"']*\\/${escaped}\\/|require\\(["']${escaped}\\/)`,
        );

        const violations = [];

        for (const file of allPackageSrc) {
          const rel = relative(ROOT, file).replace(/\\/g, "/");
          const content = readFileSync(file, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s*(?:\/\/|\*)/.test(line)) continue;
            if (pattern.test(line)) {
              violations.push(`${rel}:${i + 1}`);
            }
          }
        }

        if (violations.length > 0) {
          expect.fail(
            [
              `Source files must not import from ${dataDir}/ — it is a data directory.`,
              `Use filesystem I/O (readFileSync/writeFileSync) to access ${dataDir}/ contents.`,
              "",
              "Violations:",
              ...violations.map((v) => `  - ${v}`),
            ].join("\n"),
          );
        }
      });
    }
  });

  /**
   * Exhaustive cross-package guard for packages/web/src.
   *
   * The deny-list test above only checks imports from packages already listed
   * in GATEWAY_RULES. But a new leaf file could import from any cross-package
   * name (e.g. "@n-dx/hench" or "@n-dx/llm-client") without being caught.
   *
   * This test scans ALL non-gateway files in packages/web/src and checks for
   * runtime imports from ANY known cross-package name, not just the ones with
   * existing gateway rules. This ensures no file bypasses the gateway pattern
   * by importing from an ungated package.
   */
  it("packages/web/src: no non-gateway file imports from any cross-package name", () => {
    // Foundation-tier (@n-dx/llm-client) is intentionally ungated — it is the
    // shared bottom of the hierarchy, designed for direct use by all tiers.
    // Only domain and execution packages require gateway routing.
    const ALL_CROSS_PACKAGES = ["@n-dx/rex", "@n-dx/sourcevision", "@n-dx/hench"];

    // Collect all gateway files for web
    const webGateways = new Set();
    for (const rule of GATEWAY_RULES) {
      if (rule.packageDir === "packages/web/src") {
        for (const gw of rule.gatewayFiles) webGateways.add(gw);
      }
    }

    const webSrc = walk(join(ROOT, "packages/web/src"));
    const violations = [];

    for (const file of webSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (webGateways.has(rel)) continue;

      const content = readFileSync(file, "utf-8");
      for (const pkg of ALL_CROSS_PACKAGES) {
        if (hasRuntimeImportFrom(content, pkg)) {
          violations.push(`${rel} → ${pkg}`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Non-gateway files in packages/web/src have runtime imports from cross-package names.",
          "ALL cross-package runtime imports must go through a designated gateway module,",
          "even for packages not yet listed in gateway-rules.json.",
          "",
          `Checked packages: ${ALL_CROSS_PACKAGES.join(", ")}`,
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix: add a gateway for the package in gateway-rules.json and route the import through it.",
        ].join("\n"),
      );
    }
  });

  /**
   * Hench must not import from sourcevision at runtime.
   * Hench only has a gateway for rex — sourcevision should not be imported at all.
   */
  it("hench must not have runtime imports from sourcevision", () => {
    const henchSrc = walk(join(ROOT, "packages/hench/src"));
    const violations = [];

    for (const file of henchSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const content = readFileSync(file, "utf-8");

      if (hasRuntimeImportFrom(content, "@n-dx/sourcevision")) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Hench must not import from sourcevision at runtime.",
          "Hench sits at the execution layer and imports only from rex (via gateway) and @n-dx/llm-client.",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "If sourcevision data is needed, read it from the filesystem instead.",
        ].join("\n"),
      );
    }
  });

  /**
   * Deny-list enforcement: no file outside a designated gateway may import
   * from upstream cross-package namespaces. This inverts the gateway allowlist
   * into an opt-out deny-list — violations are impossible to introduce silently.
   *
   * For each gateway rule, we scan ALL source files in the consumer directory
   * and assert that only the designated gateway files contain runtime imports
   * from the external package. This is a superset of the per-rule tests above,
   * consolidated here for completeness.
   */
  describe("deny-list: no non-gateway file imports from upstream packages", () => {
    /** Map from consumer dir to all upstream packages that require gateways. */
    const consumerPkgMap = new Map();
    for (const rule of GATEWAY_RULES) {
      if (!consumerPkgMap.has(rule.packageDir)) {
        consumerPkgMap.set(rule.packageDir, []);
      }
      consumerPkgMap.get(rule.packageDir).push(rule);
    }

    for (const [consumerDir, rules] of consumerPkgMap) {
      it(`${consumerDir}: no non-gateway file has runtime imports from gated packages`, () => {
        const allGateways = new Set();
        for (const r of rules) {
          for (const gw of r.gatewayFiles) allGateways.add(gw);
        }

        const srcFiles = walk(join(ROOT, consumerDir));
        const violations = [];

        for (const file of srcFiles) {
          const rel = relative(ROOT, file).replace(/\\/g, "/");
          if (allGateways.has(rel)) continue;

          const content = readFileSync(file, "utf-8");
          for (const rule of rules) {
            if (hasRuntimeImportFrom(content, rule.externalPkg)) {
              violations.push(`${rel} → ${rule.externalPkg}`);
            }
          }
        }

        if (violations.length > 0) {
          expect.fail(
            [
              `Non-gateway files in ${consumerDir} have runtime imports from gated packages.`,
              "All runtime cross-package imports must go through the designated gateway module.",
              "",
              "Violations:",
              ...violations.map((v) => `  - ${v}`),
              "",
              "To fix: import from the gateway instead of the upstream package directly.",
            ].join("\n"),
          );
        }
      });
    }
  });
});

/**
 * Gateway surface parity — ensures the test suite tracks every runtime
 * re-export in each gateway file. When a new symbol is added to a gateway,
 * this test makes the growth visible so the test suite can be updated.
 */
describe("gateway surface parity", () => {
  /**
   * Count runtime (non-type) exported symbols in a gateway source file.
   * Parses `export { A, B, C } from "..."` statements (possibly multi-line)
   * and counts individual symbols. Skips `export type { ... }` blocks.
   */
  function countRuntimeExports(content) {
    // Remove block comments
    const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, "");
    const lines = cleaned.split("\n");

    let count = 0;
    let inExportBlock = false;
    let isTypeExport = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//")) continue;

      // Detect start of export statement
      if (/^export\s+type\s+\{/.test(trimmed)) {
        isTypeExport = true;
        // If single-line, skip and reset
        if (trimmed.includes("}")) {
          isTypeExport = false;
          continue;
        }
        inExportBlock = true;
        continue;
      }

      if (/^export\s+\{/.test(trimmed)) {
        isTypeExport = false;
        // Single-line export: export { A, B, C } from "..."
        if (trimmed.includes("}")) {
          const braceContent = trimmed.match(/\{([^}]*)\}/);
          if (braceContent) {
            const symbols = braceContent[1].split(",").filter((s) => s.trim().length > 0);
            count += symbols.length;
          }
          continue;
        }
        // Multi-line export starts
        inExportBlock = true;
        // Count any symbols on the opening line after the brace
        const afterBrace = trimmed.replace(/^export\s+\{/, "").trim();
        if (afterBrace) {
          const symbols = afterBrace.split(",").filter((s) => s.trim().length > 0);
          count += symbols.length;
        }
        continue;
      }

      if (inExportBlock) {
        if (trimmed.includes("}")) {
          // Closing brace line — count symbols before the brace
          if (!isTypeExport) {
            const beforeBrace = trimmed.replace(/}.*/, "").trim();
            if (beforeBrace) {
              const symbols = beforeBrace.split(",").filter((s) => s.trim().length > 0);
              count += symbols.length;
            }
          }
          inExportBlock = false;
          isTypeExport = false;
          continue;
        }
        // Continuation line inside braces
        if (!isTypeExport) {
          const symbols = trimmed.split(",").filter((s) => s.trim().length > 0);
          count += symbols.length;
        }
      }
    }

    return count;
  }

  for (const rule of GATEWAY_RULES) {
    for (const gwPath of rule.gatewayFiles) {
      it(`${gwPath} has tracked runtime re-exports (surface > 0)`, () => {
        const fullPath = join(ROOT, gwPath);
        if (!existsSync(fullPath)) return;

        const content = readFileSync(fullPath, "utf-8");
        const exportCount = countRuntimeExports(content);

        expect(exportCount).toBeGreaterThan(
          0,
          `Gateway file ${gwPath} has zero runtime re-exports — it should have at least one.`,
        );
      });
    }
  }
});

/**
 * Production → test boundary: no production source file may import from a
 * test directory. This catches the web-viewer → web-unit zone violation class
 * where a production viewer file accidentally imports test utilities, fixtures,
 * or mock helpers — a dependency that would not be caught by gateway-only checks.
 *
 * The test scans all src/ files across all packages and verifies none of them
 * import from a path containing /tests/ or /__tests__/.
 */
describe("architecture policy: production → test boundary", () => {
  const PACKAGE_SRC_DIRS = [
    "packages/rex/src",
    "packages/sourcevision/src",
    "packages/hench/src",
    "packages/web/src",
    "packages/llm-client/src",
  ];

  it("no production source file imports from test directories", () => {
    const violations = [];

    for (const srcDir of PACKAGE_SRC_DIRS) {
      const fullDir = join(ROOT, srcDir);
      if (!existsSync(fullDir)) continue;

      for (const file of walk(fullDir)) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();

          // Skip comments
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

          // Check for import/require from test paths
          const importMatch = trimmed.match(
            /(?:from\s+["']([^"']+)["']|require\(["']([^"']+)["']\))/,
          );
          if (!importMatch) continue;

          const importPath = importMatch[1] || importMatch[2];
          if (
            importPath.includes("/tests/") ||
            importPath.includes("/__tests__/") ||
            importPath.match(/^\.\.\/.*tests\//)
          ) {
            violations.push(`${rel}:${i + 1} imports "${importPath}"`);
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Production source files must not import from test directories.",
          "Test utilities, fixtures, and mocks must stay in the test layer.",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix: extract shared utilities into a src/ module or use dependency injection.",
        ].join("\n"),
      );
    }
  });
});

/**
 * Foundation tier boundary: @n-dx/llm-client is the bottom of the hierarchy.
 * Only Domain-tier packages (rex, sourcevision) and Execution-tier (hench, web)
 * may import from it. Orchestration-tier scripts must not.
 */
describe("architecture policy: foundation tier boundary (@n-dx/llm-client)", () => {
  const ORCHESTRATION_FILES = [
    "packages/core/cli.js",
    "packages/core/ci.js",
    "packages/core/web.js",
    "packages/core/config.js",
    "packages/core/pr-check.js",
    "packages/core/claude-integration.js",
  ];

  for (const file of ORCHESTRATION_FILES) {
    it(`${file} must not import from @n-dx/llm-client`, () => {
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) return;

      const content = readFileSync(fullPath, "utf-8");
      if (hasRuntimeImportFrom(content, "@n-dx/llm-client")) {
        expect.fail(
          [
            `Orchestration-tier file ${file} imports from @n-dx/llm-client.`,
            "Orchestration files must spawn CLIs — they cannot import from any package tier,",
            "including the foundation layer.",
            "",
            "Move the import into the relevant package or use child_process.spawn instead.",
          ].join("\n"),
        );
      }
    });
  }

  it("@n-dx/llm-client must not import from domain or execution packages", () => {
    const llmSrc = walk(join(ROOT, "packages/llm-client/src"));
    const forbidden = ["@n-dx/rex", "@n-dx/sourcevision", "@n-dx/hench", "@n-dx/web"];
    const violations = [];

    for (const file of llmSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const content = readFileSync(file, "utf-8");

      for (const pkg of forbidden) {
        const pattern = new RegExp(`from\\s+["']${pkg.replace("/", "\\/")}["']`);
        if (pattern.test(content)) {
          violations.push(`${rel} imports from "${pkg}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "@n-dx/llm-client (foundation) must not import from upper-tier packages.",
          "Foundation is the bottom of the hierarchy — it cannot depend on domain, execution, or orchestration.",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
        ].join("\n"),
      );
    }
  });
});
