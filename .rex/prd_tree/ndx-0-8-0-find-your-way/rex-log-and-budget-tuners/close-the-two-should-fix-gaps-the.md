---
id: "3168b075-8bb4-4ce4-aa30-c30eeb2cd8de"
level: "task"
title: "Close the two should-fix gaps the 114c4bc8 review dropped: vacuous floor test and non-cached high-usage threshold"
status: "in_progress"
priority: "medium"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "pr-17"
source: "Adversarial review of 114c4bc8 (run 9154a5e0, commit 10ecd18b): two should-fix findings recorded as dropped"
startedAt: "2026-09-28T20:55:15.490Z"
acceptanceCriteria:
  - "The adaptive floor test at token-cost.test.ts:201 asserts that at least one tokenBudget proposal is produced and that every proposal is at or above RECORDED_FLOOR; deleting either Math.max clamp in adaptive.ts makes a test fail."
  - "The workflow tuner applies the 1.2M high-consumption threshold only when the run set has a non-zero contextWriteFloor, and keeps the 100K threshold otherwise."
  - "A workflow test with input/output-only runs averaging above 100K at a success rate below 0.5 produces the high-usage suggestion, and a prompt-cached test below 1.2M does not."
description: "The review of 10ecd18b confirmed two should-fix defects and dropped both.\n\n1. packages/hench/tests/unit/agent/token-cost.test.ts:201 (\"adaptive: no tokenBudget proposal under the floor against a template budget\") asserts nothing. With the 6-run all-completed fixture and tokenBudget 600,000, neither tokenBudget branch in adaptive.ts fires: complexity scaling needs successRateTrend < -0.1, and efficiency tuning needs recentAvgTokens < tokenBudget * 0.3. So the loop over proposals runs zero times, and removing the Math.max clamp leaves the test green.\n\n2. packages/hench/src/agent/analysis/workflow.ts:183 raises HIGH_COUNTED_TOKENS_PER_RUN from 100,000 to 1,200,000 for every project. On runs with no cache writes (API/openai/google/local providers, or Anthropic without cache_control), countBudgetedTokens still returns input + output, the same number as before, so the \"High token usage with low success rate\" suggestion and its tokenBudget proposal stop firing for those projects until they average above 1.2M.\n\nKeep the change inside packages/hench; no cross-package imports. Add a patch changeset for @n-dx/hench only if user-visible behaviour changes beyond the existing budget-tuner-token-units changeset (extending that changeset is acceptable)."
lastModified: "2026-09-28T20:55:15.847Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
