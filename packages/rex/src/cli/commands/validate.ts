import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { SCHEMA_VERSION, isCompatibleSchema } from "../../schema/index.js";
import { validateDocument, validateConfig } from "../../schema/validate.js";
import { validateDAG } from "../../core/dag.js";
import { validateStructure, findEpiclessFeatures } from "../../core/structural.js";
import {
  resolveEpiclessFeatures,
  applyEpiclessResolutions,
} from "./validate-interactive.js";
import { resolveStore, ensureLegacyPrdMigrated, LegacyPrdMigrationError } from "../../store/index.js";
import { loadItemsPreferFolderTree } from "./folder-tree-sync.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import { green, yellow, red } from "@n-dx/llm-client";
import { emitMigrationNotification } from "../migration-notification.js";
import type { PRDDocument } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import type { PromptFn } from "./validate-interactive.js";

interface CheckResult {
  name: string;
  pass: boolean;
  /** "warn" checks are displayed but do not cause exit(1). */
  severity?: "error" | "warn";
  errors: string[];
}

/**
 * Options for interactive validation behavior.
 * @internal Exposed for testability — production callers use flags only.
 */
export interface ValidateOptions {
  /** Injectable prompt function for interactive resolution. */
  prompt?: PromptFn;
}

export async function cmdValidate(
  dir: string,
  flags: Record<string, string>,
  options?: ValidateOptions,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before reading PRD.
  // A migration error (typically a malformed legacy prd.json) is surfaced as a
  // failed PRD schema check rather than an uncaught throw — the rest of the
  // validate pipeline still runs against whatever else is on disk.
  const rexDir = join(dir, REX_DIR);
  const checks: CheckResult[] = [];
  let migrationError: LegacyPrdMigrationError | null = null;
  let migrationResult;
  try {
    migrationResult = await ensureLegacyPrdMigrated(dir);
  } catch (err) {
    if (err instanceof LegacyPrdMigrationError) {
      migrationError = err;
    } else {
      throw err;
    }
  }

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

  // Check PRD schema (folder-tree is authoritative; legacy migration ran above).
  // A migration failure short-circuits this check with the migration error.
  let doc: PRDDocument | null = null;
  let store: PRDStore | null = null;
  if (migrationError !== null) {
    checks.push({
      name: "PRD schema",
      pass: false,
      errors: [migrationError.message],
    });
  } else {
    try {
      store = await resolveStore(rexDir);

      // Emit migration notification to CLI and execution log
      if (migrationResult) {
        await emitMigrationNotification(migrationResult, flags, (entry) => store!.appendLog(entry));
      }

      const loaded = await store.loadDocument();
      const result = validateDocument(loaded);
      if (result.ok) {
        doc = result.data as PRDDocument;
        checks.push({ name: "PRD schema", pass: true, errors: [] });
      } else {
        checks.push({
          name: "PRD schema",
          pass: false,
          errors: result.errors.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
      }
    } catch (err) {
      checks.push({
        name: "PRD schema",
        pass: false,
        errors: [(err as Error).message],
      });
    }
  }

  // Override with folder-tree items for structural checks.
  // Falls back to the Markdown-loaded items on any error so existing checks still run.
  if (doc && store) {
    try {
      doc.items = await loadItemsPreferFolderTree(rexDir, store);
    } catch {
      // Tree load failed: structural checks will use items already in doc.
    }
  }

  // Check schema version compatibility
  if (doc) {
    if (isCompatibleSchema(doc.schema)) {
      checks.push({ name: "schema version", pass: true, errors: [] });
    } else {
      checks.push({
        name: "schema version",
        pass: false,
        errors: [`Incompatible schema "${doc.schema}", expected "${SCHEMA_VERSION}"`],
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

    // Categorise warnings by type for clearer reporting
    const blockedWarnings = structural.warnings.filter((w) => w.startsWith("Blocked without"));
    const timestampWarnings = structural.warnings.filter((w) => w.startsWith("Timestamp inconsistency"));
    const parentChildWarnings = structural.warnings.filter((w) => w.startsWith("Parent-child inconsistency"));

    if (blockedWarnings.length > 0) {
      checks.push({
        name: "blocked item dependencies",
        pass: false,
        severity: "warn",
        errors: blockedWarnings,
      });
    }

    if (timestampWarnings.length > 0) {
      checks.push({
        name: "timestamp consistency",
        pass: false,
        severity: "warn",
        errors: timestampWarnings,
      });
    }

    if (parentChildWarnings.length > 0) {
      checks.push({
        name: "parent-child status consistency",
        pass: false,
        severity: "warn",
        errors: parentChildWarnings,
      });
    }
  }

  // Detect epicless features for interactive resolution
  const epiclessFeatures = doc ? findEpiclessFeatures(doc.items) : [];

  // Determine pass/fail: warnings don't cause failure
  const errorChecks = checks.filter(
    (c) => !c.pass && c.severity !== "warn",
  );
  const allPass = errorChecks.length === 0;

  // ── JSON output (non-interactive) ──────────────────────────────────────────
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
      ...(epiclessFeatures.length > 0 ? { epiclessFeatures } : {}),
    };
    result(JSON.stringify(report, null, 2));
    if (!allPass) process.exit(1);
    return;
  }

  // ── Text output ────────────────────────────────────────────────────────────
  for (const check of checks) {
    const isWarn = !check.pass && check.severity === "warn";
    const icon = check.pass
      ? green("✓")
      : isWarn
        ? yellow("⚠")
        : red("✗");
    result(`${icon} ${check.name}`);
    if (!check.pass) {
      for (const err of check.errors) {
        const formattedErr = isWarn ? yellow(`    ${err}`) : red(`    ${err}`);
        result(formattedErr);
      }
    }
  }

  // ── Interactive epicless feature resolution ────────────────────────────────
  // Only offered in interactive TTY mode when epicless features are detected.
  // Non-interactive environments (CI, piped output, JSON mode) skip this.
  const isInteractive =
    epiclessFeatures.length > 0 &&
    doc !== null &&
    process.stdin.isTTY === true &&
    flags.yes !== "true" &&
    flags.y !== "true";

  if (isInteractive || (epiclessFeatures.length > 0 && options?.prompt)) {
    const resolutions = await resolveEpiclessFeatures(
      doc!,
      epiclessFeatures,
      options?.prompt ? { prompt: options.prompt } : undefined,
    );

    const actionable = resolutions.filter((r) => r.action !== "skip");
    if (actionable.length > 0) {
      const mutated = applyEpiclessResolutions(doc!, resolutions);
      if (mutated > 0) {
        const saveStore = store ?? await resolveStore(rexDir);
        await saveStore.saveDocument(doc!);
        await saveStore.appendLog({
          timestamp: new Date().toISOString(),
          event: "validate_interactive_fix",
          detail: `Resolved ${mutated} epicless feature${mutated === 1 ? "" : "s"} during interactive validation`,
        });
        info("");
        result(
          `Resolved ${mutated} epicless feature${mutated === 1 ? "" : "s"}.`,
        );
      }
    }
  }

  info("");
  if (allPass) {
    result(green("All checks passed."));
  } else {
    result(red("Validation failed."));
    process.exit(1);
  }
}
