---
id: "d20fbfb8-af73-4dba-9fea-e514cc253512"
type: "change"
title: "Branch work sets: a branch's tasks recorded on it, and `ndx work` picks from them"
slug: "branch-work-sets-a-branch-s-tasks"
intent: "Phase P2-1 of the change, task and branch design (workshop analysis/change-task-branches/README.md §3, decisions BW1–BW7; PR breakdown p2-pr-breakdown.md, table 'PR P2-1', D1–D5 decided 2026-11-06). A branch's work set is the tasks assigned to it. The unit is the task: assigning a change assigns its open tasks, a task-less change counts as one task, and a task sits on at most one branch (BW1). The assignment is recorded on the branch itself, per task, as `delivery: { branch }` in state.yaml (S1, BW2), so a teammate who checks out the branch sees the same set and the rex-state merge driver merges two branches' rows by item id. On a branch with a work set, `ndx work` and `get_next_task` pick only from it, and `--any` picks outside it (BW3). The default branch is never a work-set branch, so selection there is unchanged. Assignment is `rex branch add/remove/show` in the CLI and one MCP tool, `assign_to_branch` (D2). This change is the engine only: the Work page's 'On this branch' (P2-2) and the machine-local work-sets.json mirror and cross-worktree refusal (P2-3) follow in later PRs."
acceptanceCriteria:
  - "On a branch with a work set, `ndx work` and `get_next_task` pick only from it, and `--any` picks outside it."
  - "On main, selection is unchanged."
  - "Assignments merge across branches with the `rex-state` driver, without conflicts."
  - "The soft-freeze release note names the new state field, the new MCP tool and `get_next_task`'s filtering."
touches:
  - "30dbd22d-d325-4345-a66f-a1a8aa6a10f1"
  - "7de075e7-b519-4f53-a17d-d0eea465530b"
  - "4ca9aac4-cd85-4af3-96d9-c4274e2d9f83"
priority: "high"
source: "ndx-capture"
---
