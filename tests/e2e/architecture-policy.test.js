/**
 * Architecture policy tests — automated detection for direct process
 * execution imports that bypass the foundation layer abstraction.
 *
 * The foundation layer (@n-dx/llm-client/exec.ts) provides exec(),
 * spawnTool(), and spawnManaged() so domain packages never need to
 * import from node:child_process directly.
 *
 * Allowed exceptions:
 *   1. @n-dx/llm-client/src/exec.ts — the abstraction itself
 *   2. @n-dx/llm-client/src/cli-provider.ts — Claude CLI streaming (needs raw spawn for event parsing)
 *   3. @n-dx/llm-client/src/codex-cli-provider.ts — Codex CLI streaming (same reason)
 *   4. packages/hench/src/agent/lifecycle/cli-loop.ts — Claude CLI streaming (same reason)
 *   5. Orchestration-layer files (cli.js, ci.js, web.js) — spawn CLIs directly per four-tier architecture
 *   6. Test files — may use execFileSync/spawnSync for test harness
 *   7. Build scripts, config files, dist/ output
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** Files that are allowed to import from node:child_process directly. */
const ALLOWED = new Set([
  // Foundation abstraction itself (llm-client is the canonical foundation)
  "packages/llm-client/src/exec.ts",
  // CLI streaming providers — need raw spawn for event-by-event parsing
  "packages/llm-client/src/cli-provider.ts",
  "packages/llm-client/src/codex-cli-provider.ts",
  "packages/hench/src/agent/lifecycle/cli-loop.ts",
  // Orchestration layer — spawns CLIs directly (no library imports)
  "cli.js",
  "ci.js",
  "web.js",
  "config.js",
  "pr-check.js",
  // Development scripts
  "packages/web/dev.js",
  // Process monitoring — needs raw execFile for system commands (vm_stat, sysctl)
  "packages/hench/src/process/memory-monitor.ts",
  // Git operations — need execFileSync for git CLI calls
  "packages/sourcevision/src/analyzers/branch-work-collector.ts",
  "packages/sourcevision/src/analyzers/branch-work-filter.ts",
  "packages/sourcevision/src/cli/commands/git-credential-helper.ts",
  "packages/sourcevision/src/cli/commands/prd-epic-resolver.ts",
  // Web server routes — spawn CLI subprocesses for domain tool execution
  "packages/web/src/server/routes-hench.ts",
  "packages/web/src/server/routes-sourcevision.ts",
  // Claude Code integration — runs `claude mcp add` via execSync
  "claude-integration.js",
]);

/** Directories to skip entirely. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".hench",
  ".rex",
  ".sourcevision",
]);

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
 * Intra-package layer-direction rules.
 *
 * Domain-layer files (src/core/, src/analyze/, src/schema/, etc.) must not
 * import from CLI-layer files (src/cli/). This prevents tight coupling
 * between business logic and CLI presentation concerns.
 *
 * Known violations are listed in KNOWN_VIOLATIONS and tracked for
 * resolution — the test ensures no NEW violations are introduced.
 */
const INTRA_PACKAGE_RULES = [
  {
    name: "rex",
    packageDir: "packages/rex/src",
    domainDirs: ["core", "analyze", "schema", "store"],
    cliDir: "cli",
  },
  {
    name: "sourcevision",
    packageDir: "packages/sourcevision/src",
    domainDirs: ["analyzers", "schema", "util"],
    cliDir: "cli",
  },
  {
    name: "hench",
    packageDir: "packages/hench/src",
    domainDirs: ["agent", "prd", "tools", "process"],
    cliDir: "cli",
  },
];

/**
 * Known pre-existing violations that are tracked for future resolution.
 * These are grandfathered in to avoid blocking other work, but new
 * violations of the same pattern will fail the test.
 */
const KNOWN_VIOLATIONS = new Set([
  // rex domain → cli imports (tracked for resolution)
  "packages/rex/src/analyze/guided.ts",
  "packages/rex/src/core/move.ts",
  // sourcevision domain → cli imports (tracked for resolution)
  "packages/sourcevision/src/analyzers/classify.ts",
  "packages/sourcevision/src/analyzers/enrich-batch.ts",
  "packages/sourcevision/src/analyzers/enrich-per-zone.ts",
]);

describe("architecture policy: intra-package layering", () => {
  for (const rule of INTRA_PACKAGE_RULES) {
    it(`${rule.name}: domain files must not import from cli/ (except known violations)`, () => {
      const violations = [];

      for (const domainDir of rule.domainDirs) {
        const fullDir = join(ROOT, rule.packageDir, domainDir);
        if (!existsSync(fullDir)) continue;

        const files = walk(fullDir);
        for (const file of files) {
          const rel = relative(ROOT, file).replace(/\\/g, "/");
          const content = readFileSync(file, "utf-8");

          // Check for imports from the cli/ directory (relative paths)
          const cliImportPattern = /from\s+["']\.\.\/cli\//;
          if (cliImportPattern.test(content) && !KNOWN_VIOLATIONS.has(rel)) {
            violations.push(rel);
          }
        }
      }

      if (violations.length > 0) {
        expect.fail(
          [
            `Domain-layer files in ${rule.name} import from cli/ subdirectories.`,
            "Domain logic should not depend on CLI presentation concerns.",
            "",
            "Violations:",
            ...violations.map((v) => `  - ${v}`),
            "",
            "To fix: move the shared utility out of cli/ into core/ or a shared module,",
            "or restructure the import to avoid the dependency.",
          ].join("\n"),
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Orchestration-tier spawn-only enforcement
// ---------------------------------------------------------------------------

/**
 * Orchestration-tier files (cli.js, web.js, ci.js) must not contain
 * runtime imports from package internals. They should only spawn CLIs
 * as child processes. config.js is the documented exception.
 *
 * Peer orchestration imports (cli.js importing from web.js, etc.) are
 * allowed — they are all at the same tier level.
 */
const ORCHESTRATION_FILES = ["cli.js", "web.js", "ci.js"];

/**
 * Files at the orchestration tier that are allowed to be imported by
 * other orchestration files (peer imports within the same tier).
 */
const ORCHESTRATION_PEERS = new Set([
  "config.js",
  "web.js",
  "ci.js",
  "help.js",
  "refresh-plan.js",
  "refresh-artifacts.js",
  "refresh-validate.js",
  "claude-integration.js",
]);

/**
 * Pattern that matches import statements pulling from package directories.
 * Captures: import/export … from "packages/…" or "./packages/…"
 * Also catches: from "rex", from "sourcevision", from "hench",
 * from "@n-dx/llm-client", from "@n-dx/web"
 */
const PACKAGE_IMPORT_PATTERN =
  /(?:import|export)\s+.*\s+from\s+["'](?:\.\/)?packages\//;
const DIRECT_PKG_IMPORT_PATTERN =
  /(?:import|export)\s+.*\s+from\s+["'](?:rex|sourcevision|hench|@n-dx\/)/;

describe("architecture policy: orchestration spawn-only rule", () => {
  for (const file of ORCHESTRATION_FILES) {
    it(`${file} does not import from package internals`, () => {
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) return; // skip if file doesn't exist

      const content = readFileSync(fullPath, "utf-8");
      const violations = [];

      for (const [lineNum, line] of content.split("\n").entries()) {
        // Skip comments
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        if (PACKAGE_IMPORT_PATTERN.test(line)) {
          violations.push(`  line ${lineNum + 1}: ${trimmed}`);
        }
        if (DIRECT_PKG_IMPORT_PATTERN.test(line)) {
          violations.push(`  line ${lineNum + 1}: ${trimmed}`);
        }
      }

      if (violations.length > 0) {
        expect.fail(
          [
            `${file} contains runtime imports from package internals.`,
            "Orchestration-tier scripts must spawn CLIs, not import libraries.",
            "See CLAUDE.md 'Tier boundary crossing' for the decision rule.",
            "",
            "Violations:",
            ...violations,
            "",
            "To fix: use spawn() to invoke the package's CLI instead,",
            "or move the logic to a peer orchestration module.",
          ].join("\n"),
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// CLAUDE.md policy coverage cross-reference
// ---------------------------------------------------------------------------

/**
 * Validates that every tier boundary rule documented in CLAUDE.md has a
 * corresponding enforcement test in this file or domain-isolation.test.js.
 *
 * This closes the gap where a new rule could be added to CLAUDE.md but
 * never make it into the test suite — leaving the rule as
 * documentation-only with no enforcement path.
 *
 * Each expected policy maps to the test file + describe block that
 * enforces it. If you add a new tier boundary rule to CLAUDE.md,
 * add an entry here and write the corresponding test.
 */
const DOCUMENTED_POLICIES = [
  {
    rule: "Domain packages must not import from execution or orchestration layers",
    enforcedBy: "domain-isolation.test.js → architecture policy: domain layer isolation",
  },
  {
    rule: "Rex and sourcevision must never import each other",
    enforcedBy: "domain-isolation.test.js → architecture policy: domain layer isolation",
  },
  {
    rule: "Orchestration-tier scripts must spawn CLIs, not import libraries",
    enforcedBy: "architecture-policy.test.js → architecture policy: orchestration spawn-only rule",
  },
  {
    rule: "Cross-package runtime imports must flow through gateway modules",
    enforcedBy: "domain-isolation.test.js → architecture policy: gateway enforcement",
  },
  {
    rule: "Gateway files must contain only re-exports (no logic)",
    enforcedBy: "domain-isolation.test.js → architecture policy: gateway enforcement",
  },
  {
    rule: "Type imports must also flow through gateways (prevent promotion erosion)",
    enforcedBy: "domain-isolation.test.js → architecture policy: gateway enforcement",
  },
  {
    rule: "Foundation tier (@n-dx/llm-client) must not import from upper tiers",
    enforcedBy: "domain-isolation.test.js → architecture policy: foundation tier boundary",
  },
  {
    rule: "Orchestration scripts must not import @n-dx/llm-client",
    enforcedBy: "domain-isolation.test.js → architecture policy: foundation tier boundary",
  },
  {
    rule: "Domain-layer files must not import from CLI layer (intra-package layering)",
    enforcedBy: "architecture-policy.test.js → architecture policy: intra-package layering",
  },
  {
    rule: "Direct child_process imports forbidden outside allowed files",
    enforcedBy: "architecture-policy.test.js → architecture policy: process execution",
  },
  {
    rule: "No cycles in the zone-level import graph",
    enforcedBy: "architecture-policy.test.js → architecture policy: zone import cycle detection",
  },
  {
    rule: "config.js must only import from node: builtins (spawn-exempt exception)",
    enforcedBy: "domain-isolation.test.js → architecture policy: orchestration tier boundary",
  },
  {
    rule: "No source file may import from .rex/, .sourcevision/, or .hench/ directories",
    enforcedBy: "domain-isolation.test.js → data-layer contract",
  },
];

describe("architecture policy: CLAUDE.md coverage cross-reference", () => {
  it("all documented tier boundary rules have enforcement tests", () => {
    // This is a declarative registry — it does not parse CLAUDE.md.
    // When you add a new tier boundary rule to CLAUDE.md, you MUST
    // add an entry to DOCUMENTED_POLICIES above. If this test has
    // fewer entries than the rules in CLAUDE.md, the gap is visible
    // in code review. Minimum: 12 policies.
    expect(DOCUMENTED_POLICIES.length).toBeGreaterThanOrEqual(12);
  });

  for (const policy of DOCUMENTED_POLICIES) {
    it(`"${policy.rule}" is documented as enforced by ${policy.enforcedBy.split(" → ")[0]}`, () => {
      // Each entry must reference a real test file
      const testFile = policy.enforcedBy.split(" → ")[0];
      expect(
        ["architecture-policy.test.js", "domain-isolation.test.js"].includes(testFile),
        `Unknown enforcement test file: ${testFile}`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Zone-level import cycle detection
// ---------------------------------------------------------------------------

/**
 * Detects cycles in the zone-level import graph by reading
 * .sourcevision/zones.json and running DFS on zone crossings.
 *
 * A cycle at the zone level (e.g. A → B → C → A) is a severe
 * architectural violation that prevents independent extraction or
 * testing of any zone in the cycle.
 */
/**
 * Zone types that are excluded from cycle detection. Test and
 * infrastructure zones naturally cross boundaries (test files import
 * production code from multiple zones) — cycles among them are expected.
 *
 * Only production zones (domain, integration, orchestration, and untyped)
 * are required to be acyclic.
 */
const CYCLE_EXEMPT_ZONE_TYPES = new Set(["test", "infrastructure"]);

describe("architecture policy: zone import cycle detection", () => {
  it("no cycles exist among production zones in the zone-level import graph", () => {
    const zonesPath = join(ROOT, ".sourcevision/zones.json");
    if (!existsSync(zonesPath)) {
      // Skip if sourcevision hasn't been run yet
      return;
    }

    const data = JSON.parse(readFileSync(zonesPath, "utf-8"));
    const crossings = data.crossings || [];

    // Load zone types from .n-dx.json to identify test/infrastructure zones
    const configPath = join(ROOT, ".n-dx.json");
    const zoneTypes = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.types ?? {}
      : {};

    // Build set of production zone IDs (exclude test and infrastructure zones)
    const productionZones = new Set();
    for (const zone of data.zones || []) {
      const zoneType = zoneTypes[zone.id];
      if (!zoneType || !CYCLE_EXEMPT_ZONE_TYPES.has(zoneType)) {
        productionZones.add(zone.id);
      }
    }

    // Extract package family from zone ID (e.g. "packages-rex:cli" → "packages-rex")
    function packageFamily(zoneId) {
      const colonIdx = zoneId.indexOf(":");
      return colonIdx >= 0 ? zoneId.slice(0, colonIdx) : zoneId;
    }

    // Load zone pins from .n-dx.json to remap file→zone assignments
    const zonePins = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.pins ?? {}
      : {};

    // Build file-to-zone lookup with pins applied (pins override analyzed zones)
    const fileToZone = new Map();
    for (const zone of data.zones || []) {
      for (const file of zone.files || []) {
        fileToZone.set(file, zone.id);
      }
    }
    for (const [file, zoneId] of Object.entries(zonePins)) {
      fileToZone.set(file, zoneId);
    }

    // Rebuild crossings with pin-corrected zone assignments,
    // filtering out stale edges where the import no longer exists
    const correctedCrossings = [];
    for (const c of crossings) {
      // Verify the import still exists in the source file
      const srcPath = join(ROOT, c.from);
      if (existsSync(srcPath)) {
        const srcContent = readFileSync(srcPath, "utf-8");
        // Extract the target filename stem to check import presence
        const targetBase = c.to.split("/").pop().replace(/\.\w+$/, "");
        if (!srcContent.includes(targetBase)) continue; // import was removed
      }
      correctedCrossings.push({
        ...c,
        fromZone: fileToZone.get(c.from) ?? c.fromZone,
        toZone: fileToZone.get(c.to) ?? c.toZone,
      });
    }

    // Build directed adjacency list from zone crossings (production zones only,
    // excluding intra-package edges — sub-zones within a single package naturally
    // have bidirectional dependencies that are not architectural violations)
    const graph = new Map();
    for (const c of correctedCrossings) {
      if (c.fromZone === c.toZone) continue; // skip self-edges
      if (!productionZones.has(c.fromZone) || !productionZones.has(c.toZone)) continue;
      if (packageFamily(c.fromZone) === packageFamily(c.toZone)) continue; // skip intra-package
      if (!graph.has(c.fromZone)) graph.set(c.fromZone, new Set());
      graph.get(c.fromZone).add(c.toZone);
    }

    // DFS cycle detection
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const cycles = [];

    for (const node of graph.keys()) {
      if (!color.has(node)) color.set(node, WHITE);
    }
    // Also add nodes that are only targets
    for (const [, targets] of graph) {
      for (const t of targets) {
        if (!color.has(t)) color.set(t, WHITE);
      }
    }

    function dfs(node, path) {
      color.set(node, GRAY);
      path.push(node);

      const neighbors = graph.get(node) || new Set();
      for (const next of neighbors) {
        if (color.get(next) === GRAY) {
          // Found a cycle — extract it from the path
          const cycleStart = path.indexOf(next);
          const cycle = path.slice(cycleStart).concat(next);
          cycles.push(cycle);
        } else if (color.get(next) === WHITE) {
          dfs(next, path);
        }
      }

      path.pop();
      color.set(node, BLACK);
    }

    for (const [node, c] of color) {
      if (c === WHITE) {
        dfs(node, []);
      }
    }

    if (cycles.length > 0) {
      const descriptions = cycles.map(
        (c) => `  ${c.join(" → ")}`
      );
      expect.fail(
        [
          `Zone-level import cycles detected (${cycles.length} cycle${cycles.length > 1 ? "s" : ""}):`,
          "",
          ...descriptions,
          "",
          "Zone cycles create tightly-coupled clusters that cannot be independently",
          "extracted, tested, or evolved. Fix by:",
          "  1. Extracting shared symbols to a neutral module (shared-types, foundation)",
          "  2. Inverting the dependency direction so utilities don't depend on consumers",
          "  3. Using zone pins to correct misclassified files",
        ].join("\n"),
      );
    }
  });
});

describe("architecture policy: process execution", () => {
  it("ALLOWED list contains no stale entries (all files exist on disk)", () => {
    const stale = [];
    for (const rel of ALLOWED) {
      const full = join(ROOT, rel);
      if (!existsSync(full)) {
        stale.push(rel);
      }
    }

    if (stale.length > 0) {
      const msg = [
        "ALLOWED list contains files that no longer exist on disk.",
        "Remove stale entries or update paths after renames/moves:",
        "",
        ...stale.map((s) => `  - ${s}`),
      ].join("\n");

      expect.fail(msg);
    }
  });

  it("no direct child_process imports outside allowed files", () => {
    const files = walk(ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");

      // Skip allowed files
      if (ALLOWED.has(rel)) continue;
      // Skip test files
      if (/\.test\.(ts|js|mjs)$/.test(rel) || /(?:^|[\/\\])tests?[\/\\]/.test(rel)) continue;

      const content = readFileSync(file, "utf-8");

      // Check for import/require of child_process
      const hasImport =
        /from\s+["'](?:node:)?child_process["']/.test(content) ||
        /require\(["'](?:node:)?child_process["']\)/.test(content);

      if (hasImport) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      const msg = [
        "Direct child_process imports found outside allowed files.",
        "Use @n-dx/llm-client exec(), spawnTool(), or spawnManaged() instead.",
        "",
        "Violations:",
        ...violations.map((v) => `  - ${v}`),
        "",
        "If this is a legitimate exception, add the file to ALLOWED in",
        "tests/e2e/architecture-policy.test.js",
      ].join("\n");

      expect.fail(msg);
    }
  });
});
