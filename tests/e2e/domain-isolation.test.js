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
 *   Foundation      @n-dx/claude-client           (shared types, API client)
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
import { readFileSync, readdirSync, statSync } from "node:fs";
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
          "Rex sits at the domain layer and may only import from @n-dx/claude-client (foundation).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "If rex needs functionality from another package, it should be:",
          "  - Pushed down to @n-dx/claude-client (if truly shared), or",
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
        const pattern = new RegExp(`from\\s+["']${pkg.replace("/", "\\/")}["']`);
        if (pattern.test(content)) {
          violations.push(`${rel} imports from "${pkg}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Sourcevision must not import from sibling domain or upper-layer packages.",
          "Sourcevision sits at the domain layer and may only import from @n-dx/claude-client (foundation).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "If sourcevision needs functionality from another package, it should be:",
          "  - Pushed down to @n-dx/claude-client (if truly shared), or",
          "  - Coordinated via filesystem/CLI (loose coupling), or",
          "  - Restructured to avoid the dependency.",
        ].join("\n"),
      );
    }
  });
});

describe("architecture policy: gateway enforcement", () => {
  /**
   * Hench gateway: packages/hench/src/prd/rex-gateway.ts
   *
   * All runtime imports from "rex" in hench source files must go through
   * this single gateway. `import type` is allowed anywhere (zero runtime coupling).
   * The legacy re-export at prd/ops.ts is also allowed (backward compatibility).
   */
  it("hench runtime imports from rex must go through the gateway (prd/rex-gateway.ts)", () => {
    const GATEWAY = "packages/hench/src/prd/rex-gateway.ts";
    const LEGACY_GATEWAY = "packages/hench/src/prd/ops.ts";
    const henchSrc = walk(join(ROOT, "packages/hench/src"));
    const violations = [];

    for (const file of henchSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");

      // The gateway itself and its legacy re-export are allowed
      if (rel === GATEWAY || rel === LEGACY_GATEWAY) continue;

      const content = readFileSync(file, "utf-8");
      if (hasRuntimeImportFrom(content, "rex")) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Runtime imports from 'rex' found outside the hench gateway.",
          `All runtime imports must go through: ${GATEWAY}`,
          "`import type` is fine anywhere (erased at compile time).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix: import from '../prd/rex-gateway.js' (the gateway) instead of 'rex' directly.",
          `If a new rex export is needed, add it to ${GATEWAY} first.`,
        ].join("\n"),
      );
    }
  });

  /**
   * Web gateway: packages/web/src/server/domain-gateway.ts
   *
   * All runtime imports from "rex" and "sourcevision" in web source files
   * must go through this single gateway. `import type` is allowed anywhere.
   * The legacy re-export at mcp-deps.ts is also allowed (backward compatibility).
   */
  it("web runtime imports from domain packages must go through the gateway (server/domain-gateway.ts)", () => {
    const GATEWAY = "packages/web/src/server/domain-gateway.ts";
    const LEGACY_GATEWAY = "packages/web/src/server/mcp-deps.ts";
    const domainPkgs = ["rex", "sourcevision"];
    const webSrc = walk(join(ROOT, "packages/web/src"));
    const violations = [];

    for (const file of webSrc) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");

      // The gateway itself and its legacy re-export are allowed
      if (rel === GATEWAY || rel === LEGACY_GATEWAY) continue;

      const content = readFileSync(file, "utf-8");
      for (const pkg of domainPkgs) {
        if (hasRuntimeImportFrom(content, pkg)) {
          violations.push(`${rel} has runtime import from "${pkg}"`);
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Runtime imports from domain packages found outside the web gateway.",
          `All runtime imports must go through: ${GATEWAY}`,
          "`import type` is fine anywhere (erased at compile time).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix: import from './domain-gateway.js' (the gateway) instead of the domain package directly.",
          `If a new export is needed, add it to ${GATEWAY} first.`,
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

      if (hasRuntimeImportFrom(content, "sourcevision")) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Hench must not import from sourcevision at runtime.",
          "Hench sits at the execution layer and imports only from rex (via gateway) and @n-dx/claude-client.",
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
