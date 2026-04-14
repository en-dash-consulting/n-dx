/**
 * Domain-layer boundary enforcement for the rex package.
 *
 * Validates that core domain files (core/, analyze/, schema/, store/) do not
 * import from CLI satellite zones (cli/commands/). This catches the critical
 * architecture violation where the domain layer develops upward dependencies
 * on CLI command handlers, which can cause initialization failures in bundled
 * or ESM contexts.
 *
 * Specific structural issues this test guards against:
 *   - rex-prd-engine → chunked-review (domain importing from CLI satellite)
 *   - rex-core ↔ rex-unit bidirectional import cycle
 *   - batch-types.ts zone/location mismatch
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/** Extract all `from "..."` import paths — handles multi-line imports. */
function extractFromPaths(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const paths: string[] = [];
  const re = /from\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    paths.push(m[1]!);
  }
  return paths;
}

const REX_SRC = join(import.meta.dirname!, "..", "..", "src");

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;
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
  const re = /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    paths.push(m[1]!);
  }
  return paths;
}

describe("rex domain-layer boundary", () => {
  const DOMAIN_DIRS = ["core", "analyze", "schema", "store"];

  /**
   * Known violations that are tracked for resolution.
   * Each entry documents WHY the violation exists and WHEN it should be fixed.
   */
  const KNOWN_VIOLATIONS = new Map([
    // guided.ts uses cli/output for user prompts during interactive spec generation.
    // Resolution: extract a prompt abstraction into core/ that guided.ts can use.
    ["analyze/guided.ts → cli/", "Interactive spec generation requires CLI prompts — tracked for extraction"],
  ]);

  it("domain files (core/, analyze/, schema/, store/) do not import from cli/", () => {
    const violations: string[] = [];

    for (const domainDir of DOMAIN_DIRS) {
      const dir = join(REX_SRC, domainDir);
      if (!existsSync(dir)) continue;

      for (const file of collectTsFiles(dir)) {
        const rel = relative(REX_SRC, file);
        for (const imp of extractImportPaths(file)) {
          // Check for imports that reach into cli/ directory
          if (imp.includes("/cli/") || imp.match(/\.\.\/cli\b/)) {
            const key = `${rel} → cli/`;
            if (!KNOWN_VIOLATIONS.has(key)) {
              violations.push(`${rel} imports "${imp}" — domain files must not import from cli/`);
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("batch-types.ts is importable from analyze/index.ts without crossing zone boundaries", () => {
    // batch-types.ts lives in analyze/ (rex-prd-engine territory) and must be
    // re-exported through analyze/index.ts. This ensures the chunked-review
    // satellite imports these types from the domain barrel, not from a
    // misclassified file.
    const indexPath = join(REX_SRC, "analyze", "index.ts");
    const content = readFileSync(indexPath, "utf-8");

    expect(content).toContain("batch-types");
    expect(content).toMatch(/export\s+type\s+\{.*BatchAcceptanceRecord/s);
    expect(content).toMatch(/export\s+type\s+\{.*GranularityAdjustmentRecord/s);
  });

  it("chunked-review-state.ts imports batch types from analyze/, not cli/", () => {
    const statePath = join(REX_SRC, "cli", "commands", "chunked-review-state.ts");
    if (!existsSync(statePath)) return;

    const content = readFileSync(statePath, "utf-8");
    // Should import from analyze/batch-types (domain layer)
    expect(content).toMatch(/from\s+["'].*analyze\/batch-types/);
    // Should NOT re-define these types locally
    expect(content).not.toMatch(/^export\s+interface\s+BatchAcceptanceRecord/m);
    expect(content).not.toMatch(/^export\s+interface\s+GranularityAdjustmentRecord/m);
  });

  it("core/verify.ts and core/keywords.ts have no circular dependency", () => {
    // These files are in the same zone (rex-core-utilities) but should not
    // create a cycle with rex-prd-engine. Verify that verify.ts only imports
    // from core/ and schema/ (not from analyze/ or cli/).
    const verifyPath = join(REX_SRC, "core", "verify.ts");
    const keywordsPath = join(REX_SRC, "core", "keywords.ts");

    if (!existsSync(verifyPath) || !existsSync(keywordsPath)) return;

    const verifyImports = extractImportPaths(verifyPath);
    const keywordsImports = extractImportPaths(keywordsPath);

    // keywords.ts should have zero local imports (pure utility)
    const keywordsLocalImports = keywordsImports.filter(p => p.startsWith("."));
    expect(keywordsLocalImports).toEqual([]);

    // verify.ts should only import from core/ and schema/ (within rex-prd-engine)
    for (const imp of verifyImports) {
      if (!imp.startsWith(".")) continue; // skip external packages
      expect(imp).not.toMatch(/\/cli\//);
      expect(imp).not.toMatch(/\/analyze\//);
    }
  });
});

describe("rex cli/commands import surface", () => {
  /**
   * cli/commands/ files may import from:
   *   - Same zone: ./anything (sibling command files)
   *   - Adjacent CLI layer: ../errors.js, ../output.js, etc. (one level up)
   *   - Core directly: ../../core/anything (privileged direct consumer)
   *   - External packages: @n-dx/llm-client, node:*
   *
   * Imports from schema/, store/, analyze/, fix/, recommend/, workflow/
   * bypass public.ts entirely, creating a de-facto second internal API
   * that is invisible to domain-isolation.test.js and external consumers.
   *
   * The KNOWN_VIOLATIONS set below documents the current surface. Any new
   * module path outside this set will fail CI, capping surface growth and
   * making additions deliberate and visible in code review.
   */
  const KNOWN_VIOLATIONS = new Set([
    "../../analyze/acknowledge.js",
    "../../analyze/batch-types.js",
    "../../analyze/dedupe.js",
    "../../analyze/index.js",
    "../../analyze/reason.js",
    "../../analyze/reshape-reason.js",
    "../../fix/index.js",
    "../../recommend/conflict-detection.js",
    "../../recommend/create-from-recommendations.js",
    "../../schema/index.js",
    "../../schema/validate.js",
    "../../store/adapter-registry.js",
    "../../store/atomic-write.js",
    "../../store/index.js",
    "../../store/project-config.js",
    "../../workflow/default.js",
  ]);

  it("cli/commands/ does not introduce new bypass imports outside the tracked surface", () => {
    const commandsDir = join(REX_SRC, "cli", "commands");
    const newViolations: string[] = [];

    for (const file of collectTsFiles(commandsDir)) {
      const rel = relative(REX_SRC, file);
      for (const imp of extractFromPaths(file)) {
        // Only check imports that cross two directory levels (../../zone/module)
        if (!imp.startsWith("../../")) continue;
        // core/ is the privileged direct consumer — explicitly allowed
        if (imp.startsWith("../../core/")) continue;
        // Anything else not in the tracked surface is a new violation
        if (!KNOWN_VIOLATIONS.has(imp)) {
          newViolations.push(
            `${rel} imports "${imp}" — not in KNOWN_VIOLATIONS; route through public.ts or add to tracked surface with justification`,
          );
        }
      }
    }

    expect(newViolations).toEqual([]);
  });
});
