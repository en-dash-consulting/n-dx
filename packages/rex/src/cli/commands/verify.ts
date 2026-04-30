import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated } from "../../store/index.js";
import { verify } from "../../core/verify.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import { CLIError } from "../errors.js";

export async function cmdVerify(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before reading PRD
  await ensureLegacyPrdMigrated(dir);

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const config = await store.loadConfig();

  const taskId = flags.task;
  const runTests = flags["dry-run"] !== "true";
  const format = flags.format;

  // Validate task ID if provided
  if (taskId) {
    const { findItem } = await import("../../core/tree.js");
    const entry = findItem(doc.items, taskId);
    if (!entry) {
      throw new CLIError(
        `Task "${taskId}" not found.`,
        "Use 'rex status' to see available items.",
      );
    }
  }

  const verifyResult = await verify({
    projectDir: dir,
    items: doc.items,
    taskId,
    testCommand: config.test,
    runTests,
  });

  // JSON output
  if (format === "json") {
    result(JSON.stringify(verifyResult, null, 2));
    return;
  }

  // Human-readable output
  const { tasks, testRun, summary } = verifyResult;

  if (tasks.length === 0) {
    if (taskId) {
      result("No acceptance criteria found for this task.");
    } else {
      result("No tasks with acceptance criteria found.");
    }
    return;
  }

  // Per-task output
  for (const task of tasks) {
    info("");
    result(`${task.title} (${task.level})`);

    for (const cr of task.criteria) {
      const icon = cr.covered ? "✓" : "✗";
      result(`  ${icon} ${cr.criterion}`);
      if (cr.testFiles.length > 0) {
        for (const tf of cr.testFiles) {
          result(`      → ${tf}`);
        }
      }
    }

    result(`  Coverage: ${task.coveredCriteria}/${task.totalCriteria} criteria mapped to tests`);
  }

  // Summary
  info("");
  result(
    `${summary.coveredCriteria}/${summary.totalCriteria} criteria covered across ${summary.totalTasks} task(s)`,
  );

  // Test run results
  if (testRun) {
    info("");
    if (testRun.ran) {
      const icon = testRun.passed ? "✓" : "✗";
      result(`${icon} Tests ${testRun.passed ? "passed" : "failed"}`);
      if (testRun.command) {
        info(`  Command: ${testRun.command}`);
      }
      if (testRun.durationMs !== undefined) {
        info(`  Duration: ${testRun.durationMs}ms`);
      }
      if (testRun.output) {
        info("");
        info(testRun.output);
      }
    } else if (testRun.error) {
      result(`⚠ ${testRun.error}`);
    }
  }

  // Exit code: fail if tests ran and failed
  if (testRun?.ran && !testRun.passed) {
    process.exit(1);
  }
}
