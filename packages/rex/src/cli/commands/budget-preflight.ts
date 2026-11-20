/**
 * The budget gate every LLM-backed rex command runs before its first call.
 */

import { resolveStore } from "../../store/index.js";
import { BudgetExceededError } from "../errors.js";
import { warn } from "../output.js";
import { preflightBudgetCheck, formatBudgetWarnings } from "./token-format.js";

/**
 * Run the pre-flight budget check before an expensive LLM call: print any
 * budget warnings, and throw {@link BudgetExceededError} when the budget is
 * exceeded and the rex config sets `budget.abort`.
 *
 * @param rexDir  Path to the `.rex/` directory.
 * @param projectDir  Project root directory.
 */
export async function enforceBudgetPreflight(
  rexDir: string,
  projectDir: string,
): Promise<void> {
  const budgetResult = await preflightBudgetCheck(rexDir, projectDir);
  if (!budgetResult) return;

  const budgetLines = formatBudgetWarnings(budgetResult);
  if (budgetLines.length > 0) {
    for (const line of budgetLines) warn(line);
    warn("");
  }
  if (budgetResult.severity === "exceeded") {
    const store = await resolveStore(rexDir);
    const config = await store.loadConfig();
    if (config.budget?.abort) {
      throw new BudgetExceededError(budgetResult.warnings);
    }
  }
}
