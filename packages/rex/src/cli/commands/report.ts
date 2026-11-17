import { SCHEMA_VERSION } from "../../schema/index.js";
import { validateDocument } from "../../schema/validate.js";
import { validateStructure } from "../../core/structural.js";
import { walkTree } from "../../core/tree.js";
import { computeStats } from "../../core/stats.js";
import { resolveStore, isChangeLayerStore, resolveRexPaths } from "../../store/index.js";
import { checkConfigSchema, checkDag, schemaIssueLines, structuralChecks } from "./prd-checks.js";

import { result } from "../output.js";
import type { PRDDocument, PRDItem, ItemLevel } from "../../schema/index.js";
import type { TreeStats } from "../../core/stats.js";
import type { CheckResult } from "./prd-checks.js";

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
  const rexDir = resolveRexPaths(dir).rexDir;
  const checks: CheckResult[] = [];
  let doc: PRDDocument | null = null;
  // The change layer's placement rule is enforced at write time; the v1 level
  // hierarchy and "a container needs a child" do not describe it (as validate.ts).
  let changeLayer = false;

  checks.push(await checkConfigSchema(rexDir));

  // Check PRD schema (Markdown is authoritative; FileStore performs legacy migration if needed)
  try {
    const store = await resolveStore(rexDir);
    changeLayer = isChangeLayerStore(store);
    const loaded = await store.loadDocument();
    const res = validateDocument(loaded);
    if (res.ok) {
      doc = res.data as PRDDocument;
      checks.push({ name: "PRD schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "PRD schema",
        pass: false,
        errors: schemaIssueLines(res.errors),
      });
    }
  } catch (err) {
    checks.push({
      name: "PRD schema",
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
    checks.push(checkDag(doc.items));
  }

  // Structural validation: orphans, cycles, stuck tasks
  if (doc) {
    const structural = validateStructure(doc.items);
    checks.push(...structuralChecks(structural, changeLayer));

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
