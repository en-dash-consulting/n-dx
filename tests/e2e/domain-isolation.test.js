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
    expect(hasTypeImportFrom('import type { Foo } from "rex"', "rex")).toBe(true);
  });

  it("excludes runtime imports", () => {
    expect(hasTypeImportFrom('import { foo } from "rex"', "rex")).toBe(false);
  });

  it("excludes export type re-exports", () => {
    expect(hasTypeImportFrom('export type { Foo } from "rex"', "rex")).toBe(false);
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
    "cli.js",
    "ci.js",
    "web.js",
    "config.js",
    "pr-check.js",
    "claude-integration.js",
  ];

  const DOMAIN_PACKAGES = ["rex", "sourcevision", "hench", "@n-dx/web"];

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
   * Type-import gateway enforcement — closes the promotion erosion path.
   *
   * Even `import type { Foo } from "rex"` outside a gateway is an erosion
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
