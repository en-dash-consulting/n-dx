---
name: ndx-work
description: Pick up a task from the PRD and begin working on it
argument-hint: "[task-id]"
---

Pick up a task from the PRD and begin working on it.

1. Read `.rex/workflow.md` for the project's execution workflow. Follow its instructions — they define the expected discipline for task execution (TDD, validation, commit conventions, etc.)
2. If task-id provided, call `get_item` (rex MCP). Otherwise call `get_next_task` (rex MCP)
3. Call `claim_task` (rex MCP) with the task id. This holds it for this worktree so another worktree's agent skips it while you plan. If it reports the task is claimed elsewhere, pick a different task. Outside a git repository it is a no-op
4. Read task details: title, description, acceptance criteria, parent chain
5. For files mentioned in the task, use `get_file_info` and `get_imports` (sourcevision MCP) to understand current state
6. Use `get_zone` (sourcevision MCP) for the relevant architectural zone
7. Present a work plan: what needs to change, which files, what tests
8. After user approves the plan, call `update_task_status` (rex MCP) to mark as `in_progress`, then mark where this task's token usage starts: run `ndx hench usage mark --task=<id> .`. The CLI snapshots the session transcript's cumulative usage and position under the task id; step 13's record computes the task's spend as the difference between that snapshot and the transcript then — arithmetic done by code, not a timestamp typed by hand. If the command reports no session or transcript, continue; the record will say it fell back
9. Implement the changes following the workflow discipline
10. Run validation and tests as specified in the workflow
11. Call `append_log` (rex MCP) with what was done, decisions made, and issues encountered
12. When done, use `update_task_status` (rex MCP) to mark as `completed`
13. Record the work in hench run history so it is auditable alongside `ndx work` runs, together with what it cost: run `ndx hench record --task=<id> --status=completed --title="<task title>" --summary="<one-line summary>" .`. Token usage is computed by the CLI as the difference between the mark from step 8 and the session transcript now, per token class, and attributed to the task — several tasks in one session each get exactly their own slice. The run's start time is taken from the mark, so there is no timestamp to pass. Use `--status=cancelled` (or `failed`) instead if the task was not completed, and `--no-tokens` to record without usage.

> **Assisted run, not a hench run.** This skill drives the task directly through Claude Code, so — unlike `ndx work` — it does not spawn the hench agent. The record written in step 12 is marked `assisted` to keep it distinguishable from an agent run, and its token usage is read from the session transcript that Claude Code writes (located via `CLAUDE_CODE_SESSION_ID`), so `ndx usage` and the dashboard's per-item rollup include this work. If no transcript can be found the record is still written with zero usage — an unrecorded run is worse than one missing its tokens — and the command says which happened.

## Done when

`ndx hench record` has written the run record for **one** task. Stop there. Do
not pick up the next task, and do not start follow-up work the task revealed —
capture it as a PRD item instead and let it be selected on its own merits.

If the task could not be completed, the run still ends here: record it with
`--status=cancelled` or `failed` rather than leaving no record.
