---
id: "2d8c0a34-d1ae-4658-9464-743aef62c555"
type: "change"
title: "`rex usage` budget abort exits 1 with NDX_CLI_GENERIC instead of 2 with NDX_BUDGET_EXCEEDED"
slug: "rex-usage-budget-abort-exits-1-with"
intent: "Trigger: `.rex/config.json` with `budget: {tokens: 1, abort: true}` and recorded usage, then `rex usage`. usage.ts (~312) throws `BudgetExceededError` from `packages/rex/src/cli/commands/token-errors.ts:3`, which extends llm-client's `CLIError`, not rex's. The rex CLI catch (cli/index.ts ~731) calls `handleCLIError` (cli/errors.ts ~204), which honours `exitCode` and renders the suggestion only for rex's `CLIError`. Result: exit 1 and `[NDX_CLI_GENERIC] Budget exceeded: …` with no suggestion. The other LLM commands use cli/errors.ts' own BudgetExceededError (exit 2) and are fine.\n\nReachable: yes, any `rex usage` run over an aborting budget.\n\nFix options: (1, recommended) make token-errors.ts re-export or extend cli/errors.ts' BudgetExceededError so there is one class; small, and aligns exit codes. (2) teach handleCLIError to recognise llm-client CLIError subclasses; broader, affects other paths.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "`rex usage` over an aborting budget exits 2 and prints the NDX_BUDGET_EXCEEDED code with its suggestion"
  - "A test drives `rex usage` over an aborting budget and asserts the exit code and the error code"
touches:
  - "31fa50b1-31fc-48f3-a311-341ddbd510de"
priority: "high"
source: "ndx-adversarial-review"
---
