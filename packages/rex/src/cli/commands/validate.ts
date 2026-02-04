import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SCHEMA_VERSION, validateDocument, validateConfig } from "../../schema/index.js";
import { validateDAG } from "../../core/dag.js";
import { validateStructure } from "../../core/structural.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import type { PRDDocument } from "../../schema/index.js";

interface CheckResult {
  name: string;
  pass: boolean;
  /** "warn" checks are displayed but do not cause exit(1). */
  severity?: "error" | "warn";
  errors: string[];
}

export async function cmdValidate(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const checks: CheckResult[] = [];

  // Check config.json schema
  try {
    const raw = await readFile(join(rexDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateConfig(parsed);
    if (result.ok) {
      checks.push({ name: "config.json schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "config.json schema",
        pass: false,
        errors: result.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
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
  let doc: PRDDocument | null = null;
  try {
    const raw = await readFile(join(rexDir, "prd.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateDocument(parsed);
    if (result.ok) {
      doc = result.data as PRDDocument;
      checks.push({ name: "prd.json schema", pass: true, errors: [] });
    } else {
      checks.push({
        name: "prd.json schema",
        pass: false,
        errors: result.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
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
  }

  // Determine pass/fail: warnings don't cause failure
  const errorChecks = checks.filter(
    (c) => !c.pass && c.severity !== "warn",
  );
  const allPass = errorChecks.length === 0;

  // Output results
  if (flags.format === "json") {
    const report = {
      ok: allPass,
      checks,
      summary: {
        total: checks.length,
        passed: checks.filter((c) => c.pass).length,
        failed: errorChecks.length,
        warnings: checks.filter((c) => !c.pass && c.severity === "warn").length,
      },
    };
    result(JSON.stringify(report, null, 2));
    if (!allPass) process.exit(1);
    return;
  }

  for (const check of checks) {
    const isWarn = !check.pass && check.severity === "warn";
    const icon = check.pass ? "✓" : isWarn ? "⚠" : "✗";
    result(`${icon} ${check.name}`);
    if (!check.pass) {
      for (const err of check.errors) {
        result(`    ${err}`);
      }
    }
  }

  info("");
  if (allPass) {
    result("All checks passed.");
  } else {
    result("Validation failed.");
    process.exit(1);
  }
}
