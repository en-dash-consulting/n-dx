---
id: "e3300b25-4c33-4b45-9f5a-3828cfafd459"
type: "task"
title: "Work sets: hench reads the work set from rex's selector, and the hench → rex gateway cap goes back to 69"
slug: "work-sets-hench-reads-the-work-set"
description: "Ryan's rule: on a gateway export cap, design the export away before raising the cap. Task 423da32e raised the hench → rex gateway (packages/hench/src/prd/rex-gateway.ts) from 69 to 70 exports for `currentWorkSet`. Design it away: hench stops importing `currentWorkSet`. rex's selector entry that hench already imports through the gateway (findNextWorkTask / findActionableWork, or the v2 selection path hench already calls) works out the current branch's work set itself from the workspace directory it is given (unless `any` is set) and returns it with its result, so hench's autoselection, `--loop`, the menu and `--plan-queue` still narrow to it and `ndx work --resolve` still reports `workSet` (branch and ids, or null). Keep it additive: existing callers that pass no workspace see no change, and get_next_task and `rex next` keep their behaviour. rex may keep exporting `currentWorkSet` from its own public API; only the hench gateway drops it. Set `maxExports` for packages/hench/src/prd/rex-gateway.ts in tests/e2e/architecture-policy.test.js back to 69, remove the 'Raised from 69 to 70 for currentWorkSet' sentence from its description, and remove `currentWorkSet` from the hench lists in tests/integration/cross-package-contracts.test.js. Do not add another export in its place. Operator notes: scope is P2-1 only. No dashboard UI, no work-sets.json mirror, no cross-worktree refusal. hench reaches rex only through packages/hench/src/prd/rex-gateway.ts. PRD writes go through withPrdModelTransaction. Run the static root policy suites before finishing (tests/e2e/architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) and tests/integration/cross-package-contracts.test.js. Add or update a patch changeset (scoped name) for every package you touch, and keep .changeset/work-sets-soft-freeze-note.md accurate. Do not write under .claude/."
acceptanceCriteria:
  - "packages/hench/src/prd/rex-gateway.ts no longer exports currentWorkSet, and the architecture-policy and domain-isolation tests pass with the cap at 69"
  - "`ndx work --resolve` still shows the work set, and hench's work-set selection tests still pass (tests)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
blockedBy:
  - "bf6bfa6a-c7a1-4d8f-80df-7b141f4fc47d"
---
