import { CLI_ERROR_CODES, CLIError } from "@n-dx/llm-client";

export class BudgetExceededError extends CLIError {
  exitCode = 2;

  constructor(warnings: string[]) {
    super(
      `Budget exceeded:\n  ${warnings.join("\n  ")}`,
      "Adjust budget with: n-dx config rex.budget.tokens <value> or rex.budget.cost <value>",
      CLI_ERROR_CODES.BUDGET_EXCEEDED,
    );
    this.name = "BudgetExceededError";
  }
}
