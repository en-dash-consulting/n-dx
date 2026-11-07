---
id: "438dd97f-37e2-4c72-8f94-bdebe90b8183"
type: "task"
title: "Work sets: glossary, CLI and MCP reference, and the soft-freeze release-note entry"
slug: "work-sets-glossary-cli-and-mcp"
description: "Breakdown P2-1 task 6 (docs). Add \"Work set\" and \"Branch\" to docs/guide/concepts/glossary.md (a branch's work set is the tasks assigned to it; assigning a change assigns its open tasks; a task sits on at most one branch; the default branch has no work set). Document `rex branch add/remove/show` and `ndx work --any` / `rex next --any` in docs/guide/commands.md, and the `assign_to_branch` tool and get_next_task's `any` argument in docs/guide/mcp.md. Write the soft-freeze compatibility entry (docs/architecture/public-surface.md) as a patch changeset for @n-dx/rex, @n-dx/hench and @n-dx/core whose body is the release note: the new optional state field `delivery: { branch }`, the new MCP tool `assign_to_branch`, and that `get_next_task`, `rex next` and `ndx work` now pick only from the current branch's work set when it has one (unchanged on the default branch and on a branch with no assignments; `any`/`--any` opts out), in the style of the Compatibility paragraphs in docs/releases/0.10.0.md. Run `node scripts/build-cli-ui-gap.mjs --check` and regenerate docs/cli-ui-gap.md with `node scripts/build-cli-ui-gap.mjs` if it drifts. Docs only: no product code. Operator notes: scope is P2-1 only. No dashboard UI, no 'Start a branch', no work-sets.json mirror, no cross-worktree refusal (P2-2 and P2-3, later PRs). hench reaches rex only through packages/hench/src/prd/rex-gateway.ts; read docs/architecture/gateways.md and the gateway ceiling in tests/e2e/architecture-policy.test.js before adding to it, and prefer one export over several. PRD writes go through withPrdModelTransaction. Run the static root policy suites before finishing (tests/e2e/architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code). Add a patch changeset (scoped name, e.g. @n-dx/rex) for every package you touch. Do not write under .claude/."
acceptanceCriteria:
  - "The glossary defines Work set and Branch, and the CLI and MCP reference document the new commands, tool and flags"
  - "A changeset carries the soft-freeze release note naming `delivery`, `assign_to_branch` and the selection change"
  - "`node scripts/build-cli-ui-gap.mjs --check` passes"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":false}
source: "ndx-capture"
blockedBy:
  - "8bc1f961-778d-4eac-8370-2cea280bfcb6"
  - "423da32e-7728-4fdc-93ef-039f7fef121a"
---
