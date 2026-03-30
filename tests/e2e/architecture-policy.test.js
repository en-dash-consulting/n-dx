/**
 * Architecture policy tests — automated detection for direct process
 * execution imports that bypass the foundation layer abstraction.
 *
 * The foundation layer (@n-dx/llm-client/exec.ts) provides exec(),
 * spawnTool(), and spawnManaged() so domain packages never need to
 * import from node:child_process directly.
 *
 * @see tests/e2e/domain-isolation.test.js — cross-package gateway enforcement
 * @see packages/web/tests/integration/boundary-check.test.ts — intra-package server/viewer boundary
 *
 * These three test files together enforce the full architectural guardrail suite.
 * Changes to one should be reviewed against the others for consistency.
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
  "packages/core/bin/rex.js",
  "packages/core/bin/hench.js",
  "packages/core/bin/sourcevision.js",
  "packages/core/cli.js",
  "packages/core/ci.js",
  "packages/core/web.js",
  "packages/core/config.js",
  "packages/core/export.js",
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
  "packages/core/claude-integration.js",
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
const ORCHESTRATION_FILES = ["packages/core/cli.js", "packages/core/web.js", "packages/core/ci.js"];

/**
 * Files at the orchestration tier that are allowed to be imported by
 * other orchestration files (peer imports within the same tier).
 */
const ORCHESTRATION_PEERS = new Set([
  "cli-brand.js",
  "packages/core/config.js",
  "packages/core/web.js",
  "packages/core/ci.js",
  "packages/core/help.js",
  "packages/core/refresh-plan.js",
  "packages/core/refresh-artifacts.js",
  "packages/core/refresh-validate.js",
  "packages/core/claude-integration.js",
]);

/**
 * Pattern that matches import statements pulling from package directories.
 * Captures: import/export … from "packages/…" or "./packages/…"
 * Also catches: from "@n-dx/rex", from "@n-dx/sourcevision", from "@n-dx/hench",
 * from "@n-dx/llm-client", from "@n-dx/web"
 */
const PACKAGE_IMPORT_PATTERN =
  /(?:import|export)\s+.*\s+from\s+["'](?:\.\/)?packages\//;
const DIRECT_PKG_IMPORT_PATTERN =
  /(?:import|export)\s+.*\s+from\s+["']@n-dx\//;

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
  {
    rule: "No import crosses the server/viewer boundary within the web package",
    enforcedBy: "boundary-check.test.ts → server/client boundary",
  },
  {
    rule: "Production zones must meet minimum cohesion threshold (0.5)",
    enforcedBy: "architecture-policy.test.js → architecture policy: zone cohesion gate",
  },
  {
    rule: "Boundary gateway files must not exceed export caps",
    enforcedBy: "architecture-policy.test.js → architecture policy: boundary file export caps",
  },
  {
    rule: "Web package internal zones must not form import cycles",
    enforcedBy: "architecture-policy.test.js → architecture policy: web package intra-zone cycle detection",
  },
  {
    rule: "Dynamic imports must not cross zone boundaries without documentation",
    enforcedBy: "architecture-policy.test.js → architecture policy: dynamic import audit",
  },
  {
    rule: "web-shared consumers must import through barrel index, not leaf files",
    enforcedBy: "boundary-check.test.ts → server/client boundary",
  },
];

describe("architecture policy: CLAUDE.md coverage cross-reference", () => {
  it("all documented tier boundary rules have enforcement tests", () => {
    // This is a declarative registry — it does not parse CLAUDE.md.
    // When you add a new tier boundary rule to CLAUDE.md, you MUST
    // add an entry to DOCUMENTED_POLICIES above. If this test has
    // fewer entries than the rules in CLAUDE.md, the gap is visible
    // in code review. Minimum: 12 policies.
    expect(DOCUMENTED_POLICIES.length).toBe(19);
  });

  for (const policy of DOCUMENTED_POLICIES) {
    it(`"${policy.rule}" is documented as enforced by ${policy.enforcedBy.split(" → ")[0]}`, () => {
      // Each entry must reference a real test file
      const testFile = policy.enforcedBy.split(" → ")[0];
      expect(
        ["architecture-policy.test.js", "domain-isolation.test.js", "boundary-check.test.ts"].includes(testFile),
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

    // Derive package family from zone file paths (e.g. "packages/web/..." → "web")
    // Zone IDs are plain kebab-case names — the package must be inferred from
    // the files that belong to each zone, not from the zone ID itself.
    const zoneToPackage = new Map();
    for (const zone of data.zones || []) {
      const firstFile = (zone.files || [])[0];
      if (firstFile && firstFile.startsWith("packages/")) {
        zoneToPackage.set(zone.id, firstFile.split("/")[1]);
      }
    }
    function packageFamily(zoneId) {
      return zoneToPackage.get(zoneId) ?? zoneId;
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

// ---------------------------------------------------------------------------
// Zone-boundary coupling guard for non-web packages
// ---------------------------------------------------------------------------

/**
 * Ensures non-web package families (hench, rex, sourcevision, root) maintain
 * zero inter-package coupling. Currently enforced indirectly by gateway and
 * spawn-only rules, but this test makes the invariant explicit so that new
 * packages cannot accumulate coupling without a test failure.
 *
 * This test reads zone crossings from zones.json and asserts that no
 * production zone in the listed package families has outbound edges to
 * zones in a different package family — confirming coupling === 0.
 */
describe("architecture policy: non-web zone coupling guard", () => {
  it("non-web package families have zero inter-family zone coupling", () => {
    const zonesPath = join(ROOT, ".sourcevision/zones.json");
    if (!existsSync(zonesPath)) return;

    const configPath = join(ROOT, ".n-dx.json");

    const data = JSON.parse(readFileSync(zonesPath, "utf-8"));
    const crossings = data.crossings || [];

    // Load zone types to exclude test/infrastructure zones
    const zoneTypes = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.types ?? {}
      : {};

    const productionZones = new Set();
    for (const zone of data.zones || []) {
      const zoneType = zoneTypes[zone.id];
      if (!zoneType || !CYCLE_EXEMPT_ZONE_TYPES.has(zoneType)) {
        productionZones.add(zone.id);
      }
    }

    // Load zone pins
    const zonePins = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.pins ?? {}
      : {};

    // Build file-to-zone with pins
    const fileToZone = new Map();
    for (const zone of data.zones || []) {
      for (const file of zone.files || []) {
        fileToZone.set(file, zone.id);
      }
    }
    for (const [file, zoneId] of Object.entries(zonePins)) {
      fileToZone.set(file, zoneId);
    }

    // Derive package family from zone file paths (same logic as cycle detection)
    const zoneToPackage = new Map();
    for (const zone of data.zones || []) {
      const firstFile = (zone.files || [])[0];
      if (firstFile && firstFile.startsWith("packages/")) {
        zoneToPackage.set(zone.id, firstFile.split("/")[1]);
      }
    }
    function packageFamily(zoneId) {
      return zoneToPackage.get(zoneId) ?? zoneId;
    }

    // Domain package families that must remain coupling-free with each other.
    // web is excluded (has legitimate cross-package coupling via gateways).
    // llm-client (foundation) is excluded as a *target* — all tiers may import
    // from foundation by design. But llm-client as a *source* must not import
    // from domain packages (enforced separately by foundation tier boundary test).
    const COUPLING_FREE_FAMILIES = new Set([
      "packages-hench",
      "packages-rex",
      "packages-sourcevision",
    ]);

    // Foundation tier — imports *to* these families are always allowed
    const FOUNDATION_FAMILIES = new Set([
      "packages-llm-client",
    ]);

    const violations = [];

    for (const c of crossings) {
      const fromZone = fileToZone.get(c.from) ?? c.fromZone;
      const toZone = fileToZone.get(c.to) ?? c.toZone;

      if (fromZone === toZone) continue;
      if (!productionZones.has(fromZone) || !productionZones.has(toZone)) continue;

      const fromFamily = packageFamily(fromZone);
      const toFamily = packageFamily(toZone);

      if (fromFamily === toFamily) continue; // intra-package, OK

      // Imports to foundation tier are always allowed (by-design)
      if (FOUNDATION_FAMILIES.has(toFamily)) continue;

      // Only flag if both families are in the coupling-free set
      if (COUPLING_FREE_FAMILIES.has(fromFamily) && COUPLING_FREE_FAMILIES.has(toFamily)) {
        violations.push(`${fromZone} → ${toZone} (${c.from} → ${c.to})`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Non-web package families have inter-family zone coupling.",
          "These packages must remain coupling-free (enforced by gateway and spawn-only rules).",
          "",
          "Violations:",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix: route the import through a gateway module, or extract shared types to @n-dx/llm-client.",
        ].join("\n"),
      );
    }
  });
});

describe("architecture policy: intra-package layering staleness", () => {
  it("KNOWN_VIOLATIONS list contains no stale entries (all files exist on disk)", () => {
    const stale = [];
    for (const rel of KNOWN_VIOLATIONS) {
      const full = join(ROOT, rel);
      if (!existsSync(full)) {
        stale.push(rel);
      }
    }

    if (stale.length > 0) {
      const msg = [
        "KNOWN_VIOLATIONS list contains files that no longer exist on disk.",
        "Remove stale entries — the violation has been resolved (file deleted/moved):",
        "",
        ...stale.map((s) => `  - ${s}`),
      ].join("\n");

      expect.fail(msg);
    }
  });

  it("KNOWN_VIOLATIONS entries still contain the violating import", () => {
    const resolved = [];
    for (const rel of KNOWN_VIOLATIONS) {
      const full = join(ROOT, rel);
      if (!existsSync(full)) continue; // covered by staleness test above

      const content = readFileSync(full, "utf-8");
      const cliImportPattern = /from\s+["']\.\.\/cli\//;
      if (!cliImportPattern.test(content)) {
        resolved.push(rel);
      }
    }

    if (resolved.length > 0) {
      const msg = [
        "KNOWN_VIOLATIONS entries no longer contain the violating import.",
        "The violation has been resolved — remove these entries from KNOWN_VIOLATIONS:",
        "",
        ...resolved.map((r) => `  - ${r}`),
      ].join("\n");

      expect.fail(msg);
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

// ---------------------------------------------------------------------------
// Zone cohesion CI gate
// ---------------------------------------------------------------------------

/**
 * Enforces a minimum cohesion threshold for production zones.
 *
 * The current codebase has a bimodal distribution: healthy zones ≥ 0.58
 * and problem zones ≤ 0.44. A threshold of 0.5 catches all current
 * structural outliers without flagging any currently healthy zone,
 * making it a zero-false-positive enforcement rule.
 *
 * Zones below the threshold must either:
 *   1. Be refactored to improve cohesion
 *   2. Be merged into a more cohesive parent zone
 *   3. Be added to COHESION_EXCEPTIONS with a justification
 */
const COHESION_THRESHOLD = 0.5;

/**
 * Zones exempt from the cohesion gate with documented justifications.
 * Each entry must explain why the zone cannot meet the threshold and
 * what structural condition would allow removing the exemption.
 */
const COHESION_EXCEPTIONS = new Map([
  ["cli-binary-shims", "Shim scripts with no internal imports; zero cohesion by design"],
  ["project-status-hooks", "Small viewer zone (4 files); polling hooks with linear dependency chain"],
  ["rex-chunked-review", "Small CLI pipeline zone; linear review pipeline with low internal edge count"],
  ["rex-package-infrastructure", "Package config and metadata zone; no internal import structure"],
  ["rex-task-verification", "Small utility zone; unrelated verification helpers grouped by Louvain"],
]);

describe("architecture policy: zone cohesion gate", () => {
  it(`all production zones meet minimum cohesion threshold (${COHESION_THRESHOLD})`, () => {
    const zonesDir = join(ROOT, ".sourcevision/zones");
    if (!existsSync(zonesDir)) return;

    const configPath = join(ROOT, ".n-dx.json");
    const zoneTypes = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.types ?? {}
      : {};

    const violations = [];

    for (const dir of readdirSync(zonesDir)) {
      const summaryPath = join(zonesDir, dir, "summary.json");
      if (!existsSync(summaryPath)) continue;

      const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
      const cohesion = summary.riskMetrics?.cohesion;

      // Skip zones without cohesion metrics
      if (cohesion === undefined || cohesion === null) continue;

      // Skip test/infrastructure zones
      const zoneType = zoneTypes[dir];
      if (zoneType && CYCLE_EXEMPT_ZONE_TYPES.has(zoneType)) continue;

      // Skip exempted zones
      if (COHESION_EXCEPTIONS.has(dir)) continue;

      if (cohesion < COHESION_THRESHOLD) {
        violations.push(`${dir}: cohesion ${cohesion} < ${COHESION_THRESHOLD}`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          `Zones below minimum cohesion threshold (${COHESION_THRESHOLD}):`,
          "",
          ...violations.map((v) => `  - ${v}`),
          "",
          "To fix:",
          "  1. Refactor the zone to improve internal cohesion",
          "  2. Merge into a more cohesive parent zone",
          "  3. Add to COHESION_EXCEPTIONS with justification (last resort)",
        ].join("\n"),
      );
    }
  });

  it("COHESION_EXCEPTIONS contains no stale entries", () => {
    const zonesDir = join(ROOT, ".sourcevision/zones");
    if (!existsSync(zonesDir)) return;

    const stale = [];
    for (const [zoneId] of COHESION_EXCEPTIONS) {
      const summaryPath = join(zonesDir, zoneId, "summary.json");
      if (!existsSync(summaryPath)) {
        stale.push(zoneId);
        continue;
      }
      const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
      const cohesion = summary.riskMetrics?.cohesion;
      if (cohesion !== undefined && cohesion >= COHESION_THRESHOLD) {
        stale.push(`${zoneId} (cohesion ${cohesion} now meets threshold)`);
      }
    }

    if (stale.length > 0) {
      expect.fail(
        [
          "COHESION_EXCEPTIONS contains zones that no longer need exemption:",
          "",
          ...stale.map((s) => `  - ${s}`),
          "",
          "Remove the stale entry — the zone meets the cohesion threshold or no longer exists.",
        ].join("\n"),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Boundary file import-graph edge count assertions
// ---------------------------------------------------------------------------

/**
 * For large zones (355+ files), cohesion thresholds are statistically
 * insensitive — a single file change moves the metric by ≤ 0.003.
 * Instead of relying solely on cohesion, we assert maximum inbound
 * import counts on specific boundary files (gateways, barrels).
 *
 * If a boundary file's import count exceeds its cap, the gateway surface
 * has grown beyond its documented scope and needs review.
 */
const BOUNDARY_FILES = [
  {
    file: "packages/web/src/viewer/external.ts",
    maxExports: 25,
    description: "viewer outbound gateway (schema types, shared utilities, messaging)",
  },
  {
    file: "packages/web/src/server/rex-gateway.ts",
    maxExports: 50,
    description: "web→rex gateway (domain types, MCP server factory, tree utilities, constants)",
  },
  {
    file: "packages/web/src/server/domain-gateway.ts",
    maxExports: 15,
    description: "web→sourcevision gateway (MCP server factory, domain types)",
  },
  {
    file: "packages/hench/src/prd/rex-gateway.ts",
    maxExports: 30,
    description: "hench→rex gateway (schema, store, tree, task selection, timestamps)",
  },
  {
    file: "packages/hench/src/prd/llm-gateway.ts",
    maxExports: 45,
    description: "hench→llm-client gateway (config, constants, JSON, output, errors, exec)",
  },
];

describe("architecture policy: boundary file export caps", () => {
  for (const boundary of BOUNDARY_FILES) {
    it(`${boundary.file} does not exceed ${boundary.maxExports} exports`, () => {
      const fullPath = join(ROOT, boundary.file);
      if (!existsSync(fullPath)) return;

      const content = readFileSync(fullPath, "utf-8");

      // Count export statements (both named exports and re-exports)
      const exportMatches = content.match(/\bexport\s+(?:type\s+)?{[^}]*}/g) || [];
      let exportCount = 0;
      for (const match of exportMatches) {
        // Count comma-separated items within braces
        const inner = match.replace(/^export\s+(?:type\s+)?{/, "").replace(/}$/, "");
        exportCount += inner.split(",").filter((s) => s.trim()).length;
      }

      if (exportCount > boundary.maxExports) {
        expect.fail(
          [
            `${boundary.file} has ${exportCount} exports (cap: ${boundary.maxExports}).`,
            `Description: ${boundary.description}`,
            "",
            "The gateway surface has grown beyond its documented scope.",
            "Review whether all exports are necessary, or increase the cap",
            "with a justification in BOUNDARY_FILES.",
          ].join("\n"),
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Analyzer test-pairing rule
// ---------------------------------------------------------------------------

/**
 * Every analyzer service in src/analyzers/ must have a corresponding test
 * file in tests/unit/analyzers/. This prevents coverage gaps from
 * accumulating silently in the largest subdirectory.
 *
 * Files that are purely re-export barrels (index.ts) or configuration
 * constants are exempt.
 */
describe("architecture policy: analyzer test coverage pairing", () => {
  const SV_ROOT = join(ROOT, "packages/sourcevision");
  const analyzersDir = join(SV_ROOT, "src/analyzers");
  const testDir = join(SV_ROOT, "tests/unit/analyzers");

  /**
   * Analyzer files that are barrels, configs, thin wrappers, or covered
   * by sibling test files with different naming. Each exemption requires
   * a justification comment.
   */
  const EXEMPT_ANALYZERS = new Set([
    "index",                  // barrel re-export
    "enrich-config",          // configuration constants only
    "enrich-batch",           // thin orchestration wrapper around enrich-per-zone
    "enrich",                 // AI enrichment orchestrator — covered by zone-enrichment.test.ts
    "enrich-parsing",         // parsing helpers — covered by zone-enrichment.test.ts and enrich-per-zone.test.ts
    "server-route-detection", // extension of route-detection — tested via route-detection integration
    "claude-client",          // LLM API wrapper — covered by integration tests, requires API key for unit tests
    "context",                // CONTEXT.md output generator — covered by e2e/analyze tests
    "llms-txt",               // llms.txt output generator — covered by e2e/analyze tests
    "louvain",                // Louvain community detection algorithm — covered by zone-detection.test.ts
    "route-detection",        // route detection — tested via server-route-detection exemption and e2e
    "zone-hash",              // deterministic zone hashing — covered by zone-detection.test.ts
    "zones",                  // zone orchestrator — covered by zone-detection.test.ts and zone-enrichment.test.ts
  ]);

  it("each analyzer service has a corresponding test file", () => {
    if (!existsSync(analyzersDir) || !existsSync(testDir)) return;

    const analyzers = readdirSync(analyzersDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
      .map((f) => f.replace(/\.ts$/, ""));

    const testFiles = readdirSync(testDir)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.test\.ts$/, ""));

    const testSet = new Set(testFiles);

    const missing = analyzers.filter(
      (name) => !EXEMPT_ANALYZERS.has(name) && !testSet.has(name),
    );

    if (missing.length > 0) {
      expect.fail(
        [
          "Analyzer services without corresponding test files:",
          "",
          ...missing.map((m) => `  - src/analyzers/${m}.ts → tests/unit/analyzers/${m}.test.ts`),
          "",
          "Either add a test file or add the analyzer name to EXEMPT_ANALYZERS with justification.",
        ].join("\n"),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Web package intra-zone cycle detection
// ---------------------------------------------------------------------------

/**
 * The web package's internal zone layering (web-shared → viewer-message-pipeline
 * → web-viewer → web-server) has no mechanical enforcement beyond the
 * cross-package cycle detection above (which skips intra-package edges).
 *
 * This test validates the web-internal load order by asserting no reverse
 * import edges exist between the four declared web zones.
 */
const WEB_ZONE_LOAD_ORDER = [
  "web-shared",
  "viewer-message-pipeline",
  "web-viewer",
  "web-server",
];

describe("architecture policy: web package intra-zone cycle detection", () => {
  it("web internal zones respect the declared load order", () => {
    const zonesPath = join(ROOT, ".sourcevision/zones.json");
    if (!existsSync(zonesPath)) return;

    const data = JSON.parse(readFileSync(zonesPath, "utf-8"));
    const crossings = data.crossings || [];

    // Load zone pins from .n-dx.json
    const configPath = join(ROOT, ".n-dx.json");
    const zonePins = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.pins ?? {}
      : {};

    // Build file-to-zone lookup with pins applied
    const fileToZone = new Map();
    for (const zone of data.zones || []) {
      for (const file of zone.files || []) {
        fileToZone.set(file, zone.id);
      }
    }
    for (const [file, zoneId] of Object.entries(zonePins)) {
      fileToZone.set(file, zoneId);
    }

    // Build zone rank from load order (lower = earlier in load order)
    const zoneRank = new Map();
    WEB_ZONE_LOAD_ORDER.forEach((z, i) => zoneRank.set(z, i));

    // Load zone types to identify test zones
    const zoneTypes = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, "utf-8"))?.sourcevision?.zones?.types ?? {}
      : {};

    // Check for reverse edges (lower-rank zone importing from higher-rank zone
    // is fine; higher-rank importing from lower-rank would be a violation if it
    // goes against the load order). Skip test files — they naturally cross zone
    // boundaries by importing production code from multiple zones.
    const violations = [];
    for (const c of crossings) {
      const fromZone = fileToZone.get(c.from) ?? c.fromZone;
      const toZone = fileToZone.get(c.to) ?? c.toZone;

      if (fromZone === toZone) continue;
      if (!zoneRank.has(fromZone) || !zoneRank.has(toZone)) continue;

      // Skip edges originating from test zones or test files
      const fromZoneType = zoneTypes[fromZone];
      if (fromZoneType === "test") continue;
      if (c.from.includes("/tests/") || c.from.includes(".test.")) continue;

      // Skip package entry points — public.ts and cli/index.ts are composition
      // roots that necessarily import across all zones
      if (c.from.endsWith("/public.ts") || c.from.endsWith("/cli/index.ts")) continue;

      // Skip viewer-message-pipeline → web-viewer edges from hook/polling files
      // that share types with viewer components (legitimate cross-zone type deps)
      if (fromZone === "viewer-message-pipeline" && toZone === "web-viewer" &&
          (c.from.includes("/hooks/") || c.from.includes("/polling/") || c.from.includes("/components/prd-tree/"))) continue;

      // A reverse edge: importing from a zone lower in the load order
      // is expected. But importing from a zone HIGHER in the load order
      // violates the layering (foundation importing from consumer).
      if (zoneRank.get(fromZone) < zoneRank.get(toZone)) {
        // Verify the import still exists
        const srcPath = join(ROOT, c.from);
        if (existsSync(srcPath)) {
          const srcContent = readFileSync(srcPath, "utf-8");
          const targetBase = c.to.split("/").pop().replace(/\.\w+$/, "");
          if (!srcContent.includes(targetBase)) continue;
        }
        violations.push(`${fromZone} → ${toZone} (${c.from} imports ${c.to})`);
      }
    }

    if (violations.length > 0) {
      expect.fail(
        [
          "Web package internal zone layering violations detected:",
          "",
          `Expected load order: ${WEB_ZONE_LOAD_ORDER.join(" → ")}`,
          "",
          "Reverse imports (lower-layer zone importing from higher-layer zone):",
          ...violations.map((v) => `  - ${v}`),
          "",
          "Fix by moving the imported symbol to a lower layer or extracting to web-shared.",
        ].join("\n"),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Dynamic import audit
// ---------------------------------------------------------------------------

/**
 * boundary-check.test.ts uses regex-based import extraction that is blind to
 * dynamic imports (await import()). This test enumerates all dynamic import
 * call sites across package source directories and asserts none cross zone
 * boundaries without documentation.
 *
 * Dynamic imports that are known to cross zone boundaries must be listed in
 * DOCUMENTED_DYNAMIC_IMPORTS below with a justification.
 */
const DOCUMENTED_DYNAMIC_IMPORTS = new Map([
  // Hench CLI — lazy-loads command handlers to reduce startup time
  ["packages/hench/src/cli/index.ts", "CLI command dispatch — lazy-loads command handlers"],
  ["packages/hench/src/cli/commands/config.ts", "Lazy-loads LLM config helpers on demand"],
  ["packages/hench/src/cli/commands/run.ts", "Lazy-loads agent runner on demand"],
  ["packages/hench/src/cli/commands/task-lookup.ts", "Lazy-loads rex gateway for task resolution"],
  // Rex CLI — lazy-loads command handlers and heavy dependencies
  ["packages/rex/src/cli/index.ts", "CLI command dispatch — lazy-loads command handlers"],
  ["packages/rex/src/cli/commands/analyze.ts", "Chunked-review lazy import — loaded only during interactive proposal review"],
  ["packages/rex/src/cli/commands/prune.ts", "Lazy-loads LLM client for smart prune proposals"],
  ["packages/rex/src/cli/commands/remove.ts", "Lazy-loads LLM client for smart remove analysis"],
  ["packages/rex/src/cli/commands/reorganize.ts", "Lazy-loads LLM client for reorganization proposals"],
  ["packages/rex/src/cli/commands/reshape.ts", "Lazy-loads LLM client for reshape analysis"],
  ["packages/rex/src/cli/commands/smart-add.ts", "Lazy-loads LLM client for smart add proposals"],
  ["packages/rex/src/cli/commands/validate-interactive.ts", "Lazy-loads LLM client for interactive validation"],
  ["packages/rex/src/cli/commands/verify.ts", "Lazy-loads LLM client for verify analysis"],
  ["packages/rex/src/cli/mcp-tools.ts", "Lazy-loads MCP tool handlers on demand"],
  ["packages/rex/src/analyze/reason.ts", "Lazy-loads LLM client for reason analysis"],
  // Sourcevision — lazy-loads analyzers and heavy dependencies
  ["packages/sourcevision/src/cli/index.ts", "CLI command dispatch — lazy-loads analyzers"],
  ["packages/sourcevision/src/analyzers/callgraph-findings.ts", "Lazy-loads callgraph analysis on demand"],
  ["packages/sourcevision/src/analyzers/convergence.ts", "Lazy-loads convergence analyzer on demand"],
  ["packages/sourcevision/src/analyzers/imports.ts", "Lazy-loads import graph analysis on demand"],
  // Web server — lazy-loads route handlers
  ["packages/web/src/server/routes-integrations.ts", "Lazy-loads integration handlers on demand"],
  ["packages/web/src/server/routes-notion.ts", "Lazy-loads Notion integration on demand"],
  ["packages/web/src/server/routes-rex/health.ts", "Lazy-loads health check analysis on demand"],
  // Core orchestrator — dynamic import of rex public API for export pre-rendering
  ["packages/core/export.js", "Lazy-loads rex functions for static export pre-rendering"],
]);

describe("architecture policy: dynamic import audit", () => {
  it("all dynamic imports in package sources are documented", () => {
    const packagesDir = join(ROOT, "packages");
    if (!existsSync(packagesDir)) return;

    const undocumented = [];
    const dynamicImportRe = /await\s+import\s*\(/g;

    function scanDir(dir) {
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip node_modules, dist, tests
            if (["node_modules", "dist", "tests", ".git"].includes(entry.name)) continue;
            scanDir(full);
          } else if (entry.isFile() && /\.[tj]sx?$/.test(entry.name)) {
            const content = readFileSync(full, "utf-8");
            if (dynamicImportRe.test(content)) {
              const rel = relative(ROOT, full).replace(/\\/g, "/");
              if (!DOCUMENTED_DYNAMIC_IMPORTS.has(rel)) {
                undocumented.push(rel);
              }
              // Reset regex lastIndex for next file
              dynamicImportRe.lastIndex = 0;
            }
          }
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }

    scanDir(packagesDir);

    if (undocumented.length > 0) {
      expect.fail(
        [
          "Undocumented dynamic imports found in package sources:",
          "",
          ...undocumented.map((f) => `  - ${f}`),
          "",
          "Dynamic imports bypass static import analysis (boundary-check.test.ts, zone-cycle",
          "detection). Each dynamic import must be added to DOCUMENTED_DYNAMIC_IMPORTS in",
          "architecture-policy.test.js with a justification.",
        ].join("\n"),
      );
    }
  });

  it("DOCUMENTED_DYNAMIC_IMPORTS contains no stale entries", () => {
    const stale = [];
    for (const [filePath] of DOCUMENTED_DYNAMIC_IMPORTS) {
      const full = join(ROOT, filePath);
      if (!existsSync(full)) {
        stale.push(filePath);
        continue;
      }
      const content = readFileSync(full, "utf-8");
      if (!/await\s+import\s*\(/.test(content)) {
        stale.push(filePath);
      }
    }

    if (stale.length > 0) {
      expect.fail(
        [
          "DOCUMENTED_DYNAMIC_IMPORTS contains stale entries (file missing or no dynamic import):",
          "",
          ...stale.map((f) => `  - ${f}`),
          "",
          "Remove these entries — the dynamic import has been removed or the file was deleted.",
        ].join("\n"),
      );
    }
  });

  /**
   * Dynamic import target declaration — dynamic imports in analyze.ts
   * create runtime coupling to chunked-review, decomposition-review,
   * and analyze/index that is invisible to static boundary enforcement.
   * This test makes the dependencies explicit and verifiable.
   */
  it("rex analyze.ts dynamic import targets are declared and exist", () => {
    const analyzeFile = join(ROOT, "packages/rex/src/cli/commands/analyze.ts");
    if (!existsSync(analyzeFile)) return;

    const content = readFileSync(analyzeFile, "utf-8");

    // Extract dynamic import paths (handles both single and double quotes)
    const dynamicImportRe = /import\(\s*["']([^"']+)["']\s*\)/g;
    const targets = [];
    let m;
    while ((m = dynamicImportRe.exec(content)) !== null) {
      targets.push(m[1]);
    }

    // Known declared dependencies — update this list if adding new dynamic imports
    const DECLARED_DYNAMIC_DEPS = [
      "./chunked-review.js",
      "./decomposition-review.js",
      "../../analyze/guided.js",
      "../../analyze/index.js",
      "node:fs/promises",
    ];

    // Every dynamic import must be declared
    const undeclared = targets.filter((t) => !DECLARED_DYNAMIC_DEPS.includes(t));
    if (undeclared.length > 0) {
      expect.fail(
        `Undeclared dynamic imports in analyze.ts:\n${undeclared.map((t) => `  - ${t}`).join("\n")}\n\nAdd them to DECLARED_DYNAMIC_DEPS in architecture-policy.test.js`,
      );
    }

    // Declared deps should actually be imported (no stale entries)
    const stale = DECLARED_DYNAMIC_DEPS.filter((t) => !targets.includes(t));
    if (stale.length > 0) {
      expect.fail(
        `Stale declared dynamic deps:\n${stale.map((t) => `  - ${t}`).join("\n")}\n\nRemove them from DECLARED_DYNAMIC_DEPS`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Required test annotation enforcement
// ---------------------------------------------------------------------------

/**
 * Required test annotation enforcement.
 *
 * Tests listed in TESTING.md as "required" must contain the annotation
 * string "REQUIRED TEST" in a comment. This makes the required-test
 * contract machine-verifiable — removing the annotation or the test
 * file triggers a CI failure.
 */
describe("architecture policy: required test annotations", () => {
  it("required test files contain REQUIRED TEST annotation", () => {
    const REQUIRED_TEST_FILES = [
      "tests/e2e/cli-dev.test.js",
      "tests/integration/scheduler-startup.test.js",
    ];

    const violations = [];

    for (const relPath of REQUIRED_TEST_FILES) {
      const absPath = join(ROOT, relPath);
      if (!existsSync(absPath)) {
        violations.push(`${relPath} — file does not exist (required test deleted?)`);
        continue;
      }

      const content = readFileSync(absPath, "utf-8");
      if (!/REQUIRED TEST/i.test(content)) {
        violations.push(`${relPath} — missing "REQUIRED TEST" annotation`);
      }
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Intra-package one-way dependency direction
// ---------------------------------------------------------------------------

describe("intra-package dependency direction", () => {
  /**
   * Rex package: core/ is a lower tier that should not import from cli/.
   * Core files contain domain logic (fix, verify, keywords, transitions, etc.)
   * that cli command handlers depend on — not the reverse.
   */
  it("rex core/ does not import from cli/", () => {
    const rexSrc = join(ROOT, "packages/rex/src");
    const coreDir = join(rexSrc, "core");
    const violations = [];

    if (!existsSync(coreDir)) return;

    const coreFiles = walk(coreDir);
    for (const file of coreFiles) {
      const content = readFileSync(file, "utf-8");
      const rel = relative(rexSrc, file);
      const importRe =
        /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
      let m;
      while ((m = importRe.exec(content)) !== null) {
        if (m[1].includes("/cli/") || m[1].match(/\.\.\/cli\b/)) {
          violations.push(
            `${rel} imports "${m[1]}" — core/ must not depend on cli/`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Hench package: prd/ (gateway layer) should not import from agent/.
   * The prd/ directory contains gateway re-exports (rex-gateway, llm-gateway)
   * that agent code depends on — not the reverse.
   */
  it("hench prd/ does not import from agent/", () => {
    const henchSrc = join(ROOT, "packages/hench/src");
    const prdDir = join(henchSrc, "prd");
    const violations = [];

    if (!existsSync(prdDir)) return;

    const prdFiles = walk(prdDir);
    for (const file of prdFiles) {
      const content = readFileSync(file, "utf-8");
      const rel = relative(henchSrc, file);
      const importRe =
        /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}\s+from\s+|[\w*]+\s+from\s+)?["']([^"']+)["']/g;
      let m;
      while ((m = importRe.exec(content)) !== null) {
        if (m[1].includes("/agent/") || m[1].match(/\.\.\/agent\b/)) {
          violations.push(
            `${rel} imports "${m[1]}" — prd/ must not depend on agent/`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
