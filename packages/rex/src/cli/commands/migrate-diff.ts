/** Compare operator-chosen plan files; no project state, model calls or writes. */
import { resolve } from "node:path";
import { readPlanFile } from "../../migrations/plan-file.js";
import { diffPlanFiles } from "../../migrations/plan-diff.js";
import { CLIError } from "../errors.js";
import { result } from "../output.js";

export async function cmdMigrateDiff(flags: Record<string, string>): Promise<void> {
  for (const key of ["before", "after"]) {
    if (!flags[key] || flags[key] === "true") {
      throw new CLIError(`Missing --${key} path.`, "Usage: rex migrate-diff --before=<plan.json> --after=<plan.json>");
    }
  }
  try {
    const [before, after] = await Promise.all([readPlanFile(resolve(flags.before!)), readPlanFile(resolve(flags.after!))]);
    result(diffPlanFiles(before, after).trimEnd());
  } catch (error) {
    throw new CLIError(`Cannot compare migration plans: ${(error as Error).message}`, "Pass two readable v1-to-v2 JSON plan files.");
  }
}
