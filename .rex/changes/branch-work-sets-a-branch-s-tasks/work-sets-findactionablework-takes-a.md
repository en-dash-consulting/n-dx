---
id: "5f9a638c-8663-441e-9cb2-4a90be03e274"
type: "task"
title: "Work sets: `findActionableWork` takes a `workSet`, and `get_next_task` and `rex next` pass the current branch's"
slug: "work-sets-findactionablework-takes-a"
description: "Breakdown P2-1 task 4 (the selector). `findActionableWork` (packages/rex/src/core/change-selection.ts:96) gains `workSet?: ReadonlySet<string>` in WorkSelectionOptions, beside excludeIds and assignee: when given, only units whose id is in the set are candidates (a task by its own id, a task-less change by the change's id), and an empty set yields no candidates. `findNextWork` passes it through. `get_next_task` (packages/rex/src/cli/mcp-tools/get-next-task.ts) and `rex next` (cli/commands/next.ts) read the current branch with the current-branch helper (the MCP tool in the session's resolved workspace) and pass that branch's set. A branch counts as having a work set only when at least one item in the tree has `delivery.branch` equal to it, whatever its status; on the default branch, a detached HEAD, or a branch with no assignments, they pass nothing and selection is exactly as today. Add an additive `any: boolean` argument to get_next_task and `--any` to `rex next` that skip the filter (update the MCP tools-list snapshot). When the set has nothing left to pick, `rex next` prints \"Nothing left in this branch's work set; --any picks outside it\" and get_next_task says the same in its result. Claims and excludeIds keep working inside the set. Operator notes: scope is P2-1 only. No dashboard UI, no 'Start a branch', no work-sets.json mirror, no cross-worktree refusal (P2-2 and P2-3, later PRs). hench reaches rex only through packages/hench/src/prd/rex-gateway.ts; read docs/architecture/gateways.md and the gateway ceiling in tests/e2e/architecture-policy.test.js before adding to it, and prefer one export over several. PRD writes go through withPrdModelTransaction. Run the static root policy suites before finishing (tests/e2e/architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code). Add a patch changeset (scoped name, e.g. @n-dx/rex) for every package you touch. Do not write under .claude/."
acceptanceCriteria:
  - "Selector tests: in set, out of set, empty set, a task-less change in the set, and no workSet"
  - "`get_next_task` and `rex next` pick only from the current branch's set, pick outside it with `any`, and are unchanged on main and on a branch with no assignments (tests)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
blockedBy:
  - "7567a708-d942-448f-9869-3cbc2aed9bab"
  - "4f7ddb95-7409-4752-9c77-ab697ee66924"
---
