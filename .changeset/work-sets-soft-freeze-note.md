---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

Compatibility: branch work sets. The v2 `state.yaml` row takes a new optional field, `delivery: { branch }`, naming the branch whose work set holds a task; on a change it also covers the change's open tasks that carry none, so a task-less change split after assignment keeps its tasks on the branch. Existing trees load unchanged. The rex MCP server gains a tool, `assign_to_branch`, and the CLI gains `rex branch add|remove|show`. `get_next_task`, `rex next` and `ndx work` now pick only from the current branch's work set when it has one. Selection is unchanged on the default branch, on a detached HEAD and on a branch with no assignments. Pass `any: true` (MCP) or `--any` (`rex next`, `ndx work`) to pick outside the set; an explicit `--task` bypasses it.
