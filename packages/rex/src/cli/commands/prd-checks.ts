/**
 * Validation checks shared by `rex validate` and `rex report`.
 *
 * Both commands report the same config, schema, DAG and structural checks,
 * and a CI dashboard reading `rex report` must see them named and worded
 * exactly as `rex validate` prints them. Each command keeps the checks only it
 * runs (schema-version policy, warning grouping, tree checks) itself.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { validateConfig } from "../../schema/validate.js";
import { validateDAG } from "../../core/dag.js";
import type { ZodError } from "zod";
import type { PRDItem } from "../../schema/index.js";
import type { StructuralResult } from "../../core/structural.js";

export interface CheckResult {
  name: string;
  pass: boolean;
  /** "warn" checks are displayed but do not cause exit(1). */
  severity?: "error" | "warn";
  errors: string[];
}

/** One `path: message` line per schema issue. */
export function schemaIssueLines(errors: ZodError): string[] {
  return errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

/** Validate `<rexDir>/config.json` against the rex config schema. */
export async function checkConfigSchema(rexDir: string): Promise<CheckResult> {
  try {
    const raw = await readFile(join(rexDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const res = validateConfig(parsed);
    if (res.ok) {
      return { name: "config.json schema", pass: true, errors: [] };
    }
    return {
      name: "config.json schema",
      pass: false,
      errors: schemaIssueLines(res.errors),
    };
  } catch (err) {
    return {
      name: "config.json schema",
      pass: false,
      errors: [(err as Error).message],
    };
  }
}

/** Check that `blockedBy` edges form a DAG over known items. */
export function checkDag(items: PRDItem[]): CheckResult {
  const dagResult = validateDAG(items);
  if (dagResult.valid) {
    return { name: "DAG integrity", pass: true, errors: [] };
  }
  return {
    name: "DAG integrity",
    pass: false,
    errors: dagResult.errors,
  };
}

/**
 * The structural checks every validation surface reports, in report order.
 *
 * On the change layer (`changeLayer`) hierarchy placement and empty
 * containers are skipped: its placement rule is enforced at write time, and
 * the v1 level hierarchy and "a container needs a child" do not describe it.
 * `structural.warnings` are left to the caller, which groups them its own way.
 */
export function structuralChecks(
  structural: StructuralResult,
  changeLayer: boolean,
): CheckResult[] {
  const checks: CheckResult[] = [];

  if (!changeLayer) {
    checks.push({
      name: "hierarchy placement",
      pass: structural.orphanedItems.length === 0,
      errors: structural.orphanedItems.map(
        (o) => `"${o.itemId}" (${o.level}): ${o.reason}`,
      ),
    });
  }

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

  if (!changeLayer) {
    checks.push({
      name: "empty containers",
      pass: structural.emptyContainers.length === 0,
      severity: "warn",
      errors: structural.emptyContainers.map(
        (e) => `"${e.itemId}" (${e.level}): ${e.reason}`,
      ),
    });
  }

  return checks;
}
