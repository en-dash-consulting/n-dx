import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SCHEMA_VERSION } from "../../schema/index.js";
import { validateDocument, validateConfig } from "../../schema/validate.js";
import { validateDAG } from "../../core/dag.js";
import { validateStructure } from "../../core/structural.js";
import { walkTree } from "../../core/tree.js";
import { computeStats } from "../../core/stats.js";
import { REX_DIR } from "./constants.js";
import { result } from "../output.js";
import type { PRDDocument, PRDItem, ItemLevel } from "../../schema/index.js";
import type { TreeStats } from "../../core/stats.js";

interface CheckResult {
  name: string;
  pass: boolean;
  severity?: "error" | "warn";
  errors: string[];
}

interface LevelBreakdown {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
  deleted: number;
}

export interface HealthReport {
  timestamp: string;
  ok: boolean;
  validation: {
    ok: boolean;
    checks: CheckResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      warnings: number;
    };
  };
  stats: TreeStats;
  progress: {
    percent: number;
    completed: number;
    total: number;
  };
  breakdown: Partial<Record<ItemLevel, LevelBreakdown>>;
}

/** Run validation checks and return structured results (shared logic with validate.ts). */
async function runChecks(dir: string): Promise<{
  checks: CheckResult[];
  doc: PRDDocument | null;
}> {
  const rexDir = join(dir, REX_DIR);
  const checks: CheckResult[] = [];
  let doc: PRDDocument | null = null;

  // Check config.json schema
  try {
    const raw = await readFile(join(rexDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const res = validateConfig(parsed);
    if (res.ok) {
      checks.push({ name: "config.json schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "config.json schema",
        pass: false,
        errors: res.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  } catch (err) {
    checks.push({
      name: "config.json schema",
      pass: false,
      errors: [(err as Error).message],
    });
  }

  // Check prd.json schema
  try {
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const res = validateDocument(parsed);
    if (res.ok) {
      doc = res.data as PRDDocument;
      checks.push({ name: "prd.json schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "prd.json schema",
        pass: false,
        errors: res.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  } catch (err) {
    checks.push({
      name: "prd.json schema",
      pass: false,
      errors: [(err as Error).message],
    });
  }

  // Check schema version
  if (doc) {
    if (doc.schema === SCHEMA_VERSION) {
      checks.push({ name: "schema version", pass: true, errors: [] });
    } else {
      checks.push({
        name: "schema version",
        pass: false,
        errors: [`Unknown schema "${doc.schema}", expected "${SCHEMA_VERSION}"`],
      });
    }
  }

  // DAG validation
  if (doc) {
    const dagResult = validateDAG(doc.items);
    if (dagResult.valid) {
      checks.push({ name: "DAG integrity", pass: true, errors: [] });
    } else {
      checks.push({
        name: "DAG integrity",
        pass: false,
        errors: dagResult.errors,
      });
    }
  }

  // Structural validation: orphans, cycles, stuck tasks
  if (doc) {
    const structural = validateStructure(doc.items);

    checks.push({
      name: "hierarchy placement",
      pass: structural.orphanedItems.length === 0,
      errors: structural.orphanedItems.map(
        (o) => `"${o.itemId}" (${o.level}): ${o.reason}`,
      ),
    });

    checks.push({
      name: "blockedBy cycles",
      pass: structural.cycles.length === 0,
      errors: structural.cycles.map((c) => c.join(" → ")),
    });

    checks.push({
      name: "stuck tasks",
      pass: structural.stuckItems.length === 0,
      severity: "warn",
      errors: structural.stuckItems.map(
        (s) => `"${s.itemId}": ${s.reason}`,
      ),
    });

    checks.push({
      name: "empty containers",
      pass: structural.emptyContainers.length === 0,
      severity: "warn",
      errors: structural.emptyContainers.map(
        (e) => `"${e.itemId}" (${e.level}): ${e.reason}`,
      ),
    });

    if (structural.warnings.length > 0) {
      checks.push({
        name: "blocked item dependencies",
        pass: false,
        severity: "warn",
        errors: structural.warnings,
      });
    }
  }

  return { checks, doc };
}

/** Count items by level, returning a per-level breakdown. */
function computeBreakdown(items: PRDItem[]): Partial<Record<ItemLevel, LevelBreakdown>> {
  const counts: Record<ItemLevel, LevelBreakdown> = {
    epic: { total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 },
    feature: { total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 },
    task: { total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 },
    subtask: { total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 },
  };

  for (const { item } of walkTree(items)) {
    const level = counts[item.level];
    if (!level) continue;

    // Deleted items are tracked separately and excluded from total
    if (item.status === "deleted") {
      level.deleted++;
      continue;
    }

    level.total++;
    switch (item.status) {
      case "completed": level.completed++; break;
      case "in_progress": level.inProgress++; break;
      case "pending": level.pending++; break;
      case "deferred": level.deferred++; break;
      case "blocked": level.blocked++; break;
    }
  }

  // Only include levels that have items
  const result: Partial<Record<ItemLevel, LevelBreakdown>> = {};
  for (const [level, data] of Object.entries(counts)) {
    if (data.total > 0) {
      result[level as ItemLevel] = data;
    }
  }
  return result;
}

/**
 * Generate a machine-readable JSON health report for CI dashboards.
 *
 * Combines validation checks, aggregate stats, progress, and per-level
 * breakdown into a single structured JSON output.
 *
 * By default, always exits 0 (informational report). Use --fail-on-error
 * to exit 1 when validation errors are detected.
 */
export async function cmdReport(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const failOnError = flags["fail-on-error"] === "true";
  const { checks, doc } = await runChecks(dir);

  // Determine pass/fail: warnings don't cause failure
  const errorChecks = checks.filter(
    (c) => !c.pass && c.severity !== "warn",
  );
  const validationOk = errorChecks.length === 0;

  // Compute stats and progress
  const items = doc?.items ?? [];
  const stats = computeStats(items);
  const percent = stats.total > 0
    ? Math.round((stats.completed / stats.total) * 100)
    : 0;

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    ok: validationOk,
    validation: {
      ok: validationOk,
      checks,
      summary: {
        total: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: errorChecks.length,
        warnings: checks.filter((c) => !c.pass && c.severity === "warn").length,
      },
    },
    stats,
    progress: {
      percent,
      completed: stats.completed,
      total: stats.total,
    },
    breakdown: computeBreakdown(items),
  };

  result(JSON.stringify(report, null, 2));

  if (failOnError && !validationOk) {
    process.exit(1);
  }
}
