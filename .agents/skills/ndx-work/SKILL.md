---
name: ndx-work
description: Pick up a task from the PRD and begin working on it
argument-hint: "[task-id]"
---

Pick up a task from the PRD and begin working on it.

1. Read `.rex/workflow.md` for the project's execution workflow. Follow its instructions — they define the expected discipline for task execution (TDD, validation, commit conventions, etc.)
2. If task-id provided, call `get_item` (rex MCP). Otherwise call `get_next_task` (rex MCP)
3. Read task details: title, description, acceptance criteria, parent chain
4. For files mentioned in the task, use `get_file_info` and `get_imports` (sourcevision MCP) to understand current state
5. Use `get_zone` (sourcevision MCP) for the relevant architectural zone
6. Present a work plan: what needs to change, which files, what tests
7. After user approves the plan, call `update_task_status` (rex MCP) to mark as `in_progress`, and note the current time in ISO-8601 — `date -Iseconds` on POSIX shells, `Get-Date -Format o` in PowerShell, or whatever else your shell provides. Step 12 passes it as `--startedAt` so the run claims only the tokens spent from here on, not whatever the session spent before this task
8. Implement the changes following the workflow discipline
9. Run validation and tests as specified in the workflow
10. Call `append_log` (rex MCP) with what was done, decisions made, and issues encountered
11. When done, use `update_task_status` (rex MCP) to mark as `completed`
12. Record the work in hench run history so it is auditable alongside `ndx work` runs, together with what it cost: run `ndx hench record --task=<id> --status=completed --startedAt=<time from step 7> --title="<task title>" --summary="<one-line summary>"`. Token usage is read automatically from this Claude Code session's transcript and attributed to the task — only the spend since the previous record, so several tasks in one session each get their own slice rather than all claiming the total. Use `--status=cancelled` (or `failed`) instead if the task was not completed, and `--no-tokens` to record without usage.

> **Assisted run, not a hench run.** This skill drives the task directly through Claude Code, so — unlike `ndx work` — it does not spawn the hench agent. The record written in step 12 is marked `assisted` to keep it distinguishable from an agent run, and its token usage is read from the session transcript that Claude Code writes (located via `CLAUDE_CODE_SESSION_ID`), so `ndx usage` and the dashboard's per-item rollup include this work. If no transcript can be found the record is still written with zero usage — an unrecorded run is worse than one missing its tokens — and the command says which happened.
