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
    expect(hasRuntimeImportFrom('import { foo } from "rex"', "rex")).toBe(true);
    expect(hasRuntimeImportFrom('export { bar } from "rex"', "rex")).toBe(true);
    expect(hasRuntimeImportFrom('import foo from "sourcevision"', "sourcevision")).toBe(true);
  });

  it("excludes type-only imports", () => {
    expect(hasRuntimeImportFrom('import type { Foo } from "rex"', "rex")).toBe(false);
    expect(hasRuntimeImportFrom('export type { Bar } from "rex"', "rex")).toBe(false);
  });

  it("excludes comments", () => {
    expect(hasRuntimeImportFrom('// import { foo } from "rex"', "rex")).toBe(false);
    expect(hasRuntimeImportFrom('* import { foo } from "rex"', "rex")).toBe(false);
  });

  it("does not match unrelated packages", () => {
    expect(hasRuntimeImportFrom('import { foo } from "rex"', "sourcevision")).toBe(false);
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

describe("architecture policy: domain layer isolation", () => {
  it("rex must not import from sourcevision, hench, or @n-dx/web", () => {
    const forbidden = ["sourcevision", "hench", "@n-dx/web"];
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
    const forbidden = ["rex", "hench", "@n-dx/web"];
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
});

/**
 * Gateway rules loaded from the shared gateway-rules.json.
 *
 * This is the single source of truth for gateway file paths and allowed
 * import patterns, shared with ci.js to prevent silent divergence.
 */
const _gatewayConfig = JSON.parse(readFileSync(join(ROOT, "gateway-rules.json"), "utf-8"));

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
   * Hench must not import from sourcevision at runtime.
   * Hench only has a gateway for rex — sourcevision should not be imported at all.
   */
  it("hench must not have runtime imports from sourcevision", () => {
    const henchSrc = walk(join(ROOT, "packages/hench/src"));
    const violations = [];

    for (const file of henchSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const content = readFileSync(file, "utf-8");

      if (hasRuntimeImportFrom(content, "sourcevision")) {
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
});
