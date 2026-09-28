---
id: "64d03ebd-f36e-4a3d-9d5e-e4bca0a2717c"
level: "task"
title: "Make the tuners' context-write floor hold when no cached run completed, and harden the two threshold tests"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "rex-log-budget-tuners"
  - "hench"
source: "Adversarial review of 3168b075 (run d49d67f3, commit f5ac4650): four findings left for the operator"
acceptanceCriteria:
  - "For a run set whose runs wrote cache but none completed, contextWriteFloor (or its replacement) is non-zero, every tokenBudget clamp in adaptive.ts and workflow.ts holds, and a test built from failed prompt-cached runs asserts it."
  - "The workflow high-usage gate picks the cached threshold for any run set with cache writes, whatever the runs' status; a test with all-failed cached runs below 1.2M asserts no high-usage suggestion."
  - "The adaptive floor test's name states what it guards, and a case at the 600,000 template budget either asserts a clamped proposal or asserts explicitly that no tokenBudget branch fires."
  - "Both workflow threshold tests assert successRate < 0.5 as a precondition."
description: "contextWriteFloor (packages/hench/src/agent/token-cost.ts) only counts runs that both completed and wrote cache (cacheCreationInput > 0). For a run set with no completed run it returns 0, however much cache the runs wrote. Two consequences:\n\n1. (review finding 4, from 10ecd18b) Every floor clamp becomes a no-op: adaptive.ts:283 Math.max(round(budget * 1.3), 0), adaptive.ts:403 Math.max(round(avg * 2.5), 0), and workflow.ts:222 Math.max(round(avg * 0.7), 0). The protection is missing in exactly the situation it was built for: a project whose runs keep failing.\n2. (review finding 1, from f5ac4650) The workflow high-usage gate (workflow.ts:206) reads floor 0 as \"no cache writes\" and uses the 100K uncached threshold, so an all-failed prompt-cached set fires the suggestion the 1.2M rescale was meant to silence. The reviewer proved this with a throwaway test: three failed cached runs with cacheCreationInput 100,000 / 600,000 / 550,000 give contextWriteFloor 0.\n\nOne decision settles both: what the tuners do when no arrival cost has been measured from a completed run. For example, decide \"is this project prompt-cached\" from any run with cacheCreationInput > 0 whatever its status, and base the floor on the cheapest cache-writing run (or on its cache-write component) when no cached run has completed.\n\nTest hardening from the same review:\n3. (finding 2) tests/unit/agent/token-cost.test.ts:201 is named \"... against a template budget\" but now runs at tokenBudget 100,000; the shipped templates use 600,000 (schema/templates.ts:88 and :139). Rename it to what it guards, and optionally add a case pinned at 600,000.\n4. (finding 3) The \"prompt-cached runs below 1.2M do not produce the high-usage suggestion\" test (token-cost.test.ts:311) does not pin successRate < 0.5, so a fixture edit could make it pass vacuously. Assert the precondition in both threshold tests.\n\nNothing shipped calls these tuners (analyzeWorkflow/analyzeAdaptive are not in public.ts or the agent barrel's named exports), so the exposure is to library consumers. The dashboard port in 2b6d34ae (#431) has to answer the same floor question, so settle it here first or together. Not part of 0.8.0 PR B1; move with 2b6d34ae and 0663c13a to the release after 0.8.0."
lastModified: "2026-09-28T21:15:42.649Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
