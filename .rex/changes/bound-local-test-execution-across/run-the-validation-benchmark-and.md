---
id: "53be00af-2a22-4259-a5ce-ef69d8171b17"
type: "task"
title: "Run the validation benchmark and record the baseline"
slug: "run-the-validation-benchmark-and"
description: "PR 4 of the validation gate wave 1 stack, task 2 of 2. OPERATOR task: run by hand, not through `ndx work` (an agent session cannot run an hour-long benchmark, and the machine must otherwise be idle).\n\nOn a quiet machine (no other ndx work runs, gates or vitest; close other heavy apps), from the stack's tip with a fresh build, run the default matrix:\n\n`node scripts/bench/validation-bench.mjs --out ~/ndx-core/local-design-workshop/docs/analysis/task-prep/validation-bench-<date>/`\n\n(cases A–D, fixtures hench, llm-client and web, one repeat; about an hour). Then write a short results note beside docs/analysis/task-prep/03-overnight-audit.md in the workshop with the summary table and the answers to:\n- B against A: how much slower is one capped run?\n- D against C: peak memory, peak swap, page-outs, load-induced failures or timeouts, and total batch time.\n- Whether the cap of 2 and the slot capacity of 1 look right for a 16 GB machine, or what to change.\nRecord the commit and machine (cores, memory, macOS version) in the note. If D does not beat C on memory/swap/failures, say so plainly: it decides whether the pilot settings stay on.\n\nMark this task completed with a resolution that links the note. Re-run the same command after wave 2 (selection) to measure that wave against this baseline."
acceptanceCriteria:
  - "The default benchmark matrix has been run on a quiet machine at the stack's tip, with commit and machine recorded"
  - "A results note in the workshop's task-prep analysis folder holds the summary table and answers B vs A, D vs C, and whether the pilot cap and slot capacity should change"
  - "The task's resolution links the note"
priority: "medium"
tags:
  - "validation-gate"
  - "wave-1"
  - "pr-4-benchmark"
  - "operator"
source: "ndx-capture"
blockedBy:
  - "92b189a1-8d77-463f-b524-a29b015eb6f9"
---
