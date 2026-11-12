---
id: "423da32e-7728-4fdc-93ef-039f7fef121a"
type: "task"
title: "Work sets: `ndx work` picks only from the branch's set, and `--any` picks outside it"
slug: "work-sets-ndx-work-picks-only-from-the"
description: "Breakdown P2-1 task 5 (hench, core). hench's selection (packages/hench/src/agent/planning/work-selection.ts, beside the `--mine` assignee handling) passes the current branch's work set to rex's selector for autoselection, `--loop`, `--plan-queue` and `--epic-by-epic`, using the same rule as get_next_task: no work set on the default branch, a detached HEAD, or a branch with no assignments, so selection there is unchanged. Add `--any` to `hench run` and to `ndx work` (packages/core/cli.js forwards it), which skips the filter. An explicit `--task` bypasses the set, as it does `--mine`. When the set has nothing left, print \"Nothing left in this branch's work set; --any picks outside it\" and exit as an empty selection does today. `ndx work --resolve` output names the work set (branch and ids, or none). Reach rex through packages/hench/src/prd/rex-gateway.ts only; check the gateway ceiling first and keep the new surface to one export if you can. Update hench and core help text for --any. Operator notes: scope is P2-1 only. No dashboard UI, no 'Start a branch', no work-sets.json mirror, no cross-worktree refusal (P2-2 and P2-3, later PRs). hench reaches rex only through packages/hench/src/prd/rex-gateway.ts; read docs/architecture/gateways.md and the gateway ceiling in tests/e2e/architecture-policy.test.js before adding to it, and prefer one export over several. PRD writes go through withPrdModelTransaction. Run the static root policy suites before finishing (tests/e2e/architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code). Add a patch changeset (scoped name, e.g. @n-dx/rex) for every package you touch. Do not write under .claude/."
acceptanceCriteria:
  - "hench tests for autoselection, `--loop`, `--plan-queue` and `--epic-by-epic` on a work-set branch, `--any`, an explicit `--task` outside the set, and an empty set"
  - "On main and on a branch with no assignments, selection is unchanged (tests)"
  - "`ndx work --help` and `hench run --help` list `--any`, and `--resolve` shows the set (tests)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
blockedBy:
  - "5f9a638c-8663-441e-9cb2-4a90be03e274"
---
