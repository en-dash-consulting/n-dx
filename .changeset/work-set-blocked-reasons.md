---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

A branch work set whose open tasks cannot be picked no longer reports "Nothing left". `rex next`, `get_next_task` and `ndx work` (including `--loop` and `--plan-queue`) name each open task and why it cannot be picked (claimed by another worktree, blocked by an unfinished task, naming it and saying when it is outside the set, its change awaiting placement in the Inbox or not workable, filtered out by `--mine` or `--tags`) and name `--any`; `rex next` exits 1 and `ndx work` does not report success. Only a set with no open tasks says it is finished. `rex branch show` marks each task that cannot be picked with its reason. `rex branch add` and `assign_to_branch` refuse a change awaiting placement in the Inbox, saying to place it first, and warn when an assigned task is blocked by an unfinished item outside the set.
